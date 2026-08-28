import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { StorageProvider } from '@promptowl/contextnest-engine';
import { StorageConflictError } from '@promptowl/contextnest-engine';

export interface AzureBlobStorageConfig {
  containerName: string;
  vaultId: string;
}

function createBlobServiceClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    return BlobServiceClient.fromConnectionString(connectionString);
  }
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  if (!accountUrl) {
    throw new Error(
      'Azure Blob Storage requires AZURE_STORAGE_ACCOUNT_URL (managed identity) or AZURE_STORAGE_CONNECTION_STRING'
    );
  }
  return new BlobServiceClient(accountUrl, new DefaultAzureCredential());
}

export class AzureBlobStorageProvider implements StorageProvider {
  private readonly containerClient;

  constructor(private readonly config: AzureBlobStorageConfig) {
    this.containerClient = createBlobServiceClient().getContainerClient(config.containerName);
  }

  private blobName(path: string): string {
    return `${this.config.vaultId}/${path}`;
  }

  private stripVaultPrefix(name: string): string {
    const pfx = `${this.config.vaultId}/`;
    return name.startsWith(pfx) ? name.slice(pfx.length) : name;
  }

  async read(path: string): Promise<Buffer | null> {
    try {
      const response = await this.containerClient.getBlobClient(this.blobName(path)).download();
      const stream = response.readableStreamBody;
      if (!stream) return null;
      return await streamToBuffer(stream);
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    await this.containerClient
      .getBlockBlobClient(this.blobName(path))
      .upload(data, data.length);
  }

  async delete(path: string): Promise<void> {
    await this.containerClient.getBlobClient(this.blobName(path)).deleteIfExists();
  }

  async deleteDir(prefix: string): Promise<void> {
    for await (const item of this.containerClient.listBlobsFlat({ prefix: this.blobName(prefix) })) {
      await this.containerClient.getBlobClient(item.name).deleteIfExists();
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const data = await this.read(from);
    if (data === null) return;
    await this.write(to, data);
    await this.delete(from);
  }

  async list(pattern: string): Promise<string[]> {
    // Mirror BlobStorageProvider: extract fixed prefix before first *, filter by suffix after last *.
    const parts = pattern.split('*');
    const prefix = parts[0];
    const suffix = parts.length > 1 && !pattern.endsWith('*') ? parts[parts.length - 1] : '';

    const results: string[] = [];
    for await (const item of this.containerClient.listBlobsFlat({ prefix: this.blobName(prefix) })) {
      const path = this.stripVaultPrefix(item.name);
      if (!suffix || path.endsWith(suffix)) {
        results.push(path);
      }
    }
    return results.sort();
  }

  async exists(path: string): Promise<boolean> {
    return this.containerClient.getBlobClient(this.blobName(path)).exists();
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    // TODO(task-3): Implement with proper Azure Blob metadata support
    try {
      const properties = await this.containerClient.getBlobClient(this.blobName(path)).getProperties();
      return {
        size: properties.contentLength ?? 0,
        mtimeMs: properties.lastModified?.getTime() ?? Date.now(),
      };
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async writeExclusive(path: string, data: Buffer): Promise<void> {
    // TODO(task-3): Implement with best-effort existence check (racy under concurrent writes)
    const exists = await this.exists(path);
    if (exists) {
      throw new StorageConflictError(path);
    }
    await this.write(path, data);
  }

  async appendOrCreate(path: string, header: string, entry: string): Promise<void> {
    // TODO(task-3): Implement as read-modify-write (non-atomic)
    const existing = await this.read(path);
    if (!existing) {
      await this.write(path, Buffer.from(header + entry, 'utf-8'));
      return;
    }
    await this.write(path, Buffer.concat([
      existing,
      Buffer.from(entry, 'utf-8'),
    ]));
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode: number }).statusCode === 404
  );
}
