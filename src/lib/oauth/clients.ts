// Persistent OAuth client registry. The backend is selected the same way the
// vault storage layer selects its provider (see src/lib/vault/storage/index.ts)
// so client records land in whatever store the deployment already uses:
//   - CONTEXTNEST_STORAGE=fs                          → local filesystem
//   - CONTEXTNEST_STORAGE=blob + PROVIDER=vercel       → Vercel Blob (default)
//   - CONTEXTNEST_STORAGE=blob + PROVIDER=azure        → Azure Blob Storage
// Records live under a top-level oauth-clients/ namespace, kept separate from
// the git-versioned vault so they never show up in vault listings.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { put, get, BlobNotFoundError } from '@vercel/blob';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

export interface OAuthClientRecord {
  name: string;
  redirectUris: string[];
}

function recordKey(clientId: string): string {
  return `oauth-clients/${clientId}.json`;
}

// ---- Azure Blob backend ----------------------------------------------------

function azureContainerClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
  let service: BlobServiceClient;
  if (connectionString) {
    service = BlobServiceClient.fromConnectionString(connectionString);
  } else if (accountUrl) {
    service = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  } else {
    throw new Error(
      'Azure Blob Storage requires AZURE_STORAGE_ACCOUNT_URL (managed identity) or AZURE_STORAGE_CONNECTION_STRING'
    );
  }
  const containerName = process.env.AZURE_BLOB_CONTAINER ?? 'skynest';
  return service.getContainerClient(containerName);
}

// ---- filesystem backend ----------------------------------------------------

function fsPath(clientId: string): string {
  const base = process.env.CONTEXTNEST_VAULT_PATH;
  if (!base) throw new Error('CONTEXTNEST_VAULT_PATH env var is required when CONTEXTNEST_STORAGE=fs');
  return path.join(base, recordKey(clientId));
}

// ---- provider dispatch -----------------------------------------------------

function storageMode(): string {
  return process.env.CONTEXTNEST_STORAGE ?? 'blob';
}

function blobProvider(): string {
  return process.env.CONTEXTNEST_STORAGE_PROVIDER ?? 'vercel';
}

export async function registerClient(clientId: string, record: OAuthClientRecord): Promise<void> {
  const json = JSON.stringify(record);

  if (storageMode() === 'fs') {
    const filePath = fsPath(clientId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, json, 'utf8');
    return;
  }

  const provider = blobProvider();
  if (provider === 'vercel') {
    await put(recordKey(clientId), json, { access: 'private', addRandomSuffix: false, allowOverwrite: true });
    return;
  }
  if (provider === 'azure') {
    const data = Buffer.from(json, 'utf8');
    await azureContainerClient().getBlockBlobClient(recordKey(clientId)).upload(data, data.length);
    return;
  }
  throw new Error(`Unknown CONTEXTNEST_STORAGE_PROVIDER value: "${provider}"`);
}

export async function getClient(clientId: string): Promise<OAuthClientRecord | undefined> {
  if (storageMode() === 'fs') {
    try {
      const text = await fs.readFile(fsPath(clientId), 'utf8');
      return JSON.parse(text) as OAuthClientRecord;
    } catch (err: unknown) {
      if (isFsNotFound(err)) return undefined;
      throw err;
    }
  }

  const provider = blobProvider();
  if (provider === 'vercel') {
    try {
      const result = await get(recordKey(clientId), { access: 'private', useCache: false });
      if (!result || !result.stream) return undefined;
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as OAuthClientRecord;
    } catch (err: unknown) {
      if (err instanceof BlobNotFoundError) return undefined;
      throw err;
    }
  }
  if (provider === 'azure') {
    try {
      const response = await azureContainerClient().getBlobClient(recordKey(clientId)).download();
      const stream = response.readableStreamBody;
      if (!stream) return undefined;
      const text = await streamToString(stream);
      return JSON.parse(text) as OAuthClientRecord;
    } catch (err: unknown) {
      if (isAzureNotFound(err)) return undefined;
      throw err;
    }
  }
  throw new Error(`Unknown CONTEXTNEST_STORAGE_PROVIDER value: "${provider}"`);
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function isAzureNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode: number }).statusCode === 404
  );
}

function isFsNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
