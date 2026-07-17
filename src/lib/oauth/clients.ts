// Persistent OAuth client registry backed by Azure Blob Storage.
// Each client is stored at oauth-clients/{clientId}.json so records survive
// across container instances (the previous in-memory Map did not).

import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

export interface OAuthClientRecord {
  name: string;
  redirectUris: string[];
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

function getContainerClient() {
  const containerName = process.env.AZURE_BLOB_CONTAINER ?? 'skynest';
  return createBlobServiceClient().getContainerClient(containerName);
}

function blobKey(clientId: string): string {
  return `oauth-clients/${clientId}.json`;
}

export async function registerClient(clientId: string, record: OAuthClientRecord): Promise<void> {
  const data = Buffer.from(JSON.stringify(record), 'utf8');
  await getContainerClient().getBlockBlobClient(blobKey(clientId)).upload(data, data.length);
}

export async function getClient(clientId: string): Promise<OAuthClientRecord | undefined> {
  try {
    const response = await getContainerClient().getBlobClient(blobKey(clientId)).download();
    const stream = response.readableStreamBody;
    if (!stream) return undefined;
    const text = await streamToString(stream);
    return JSON.parse(text) as OAuthClientRecord;
  } catch (err: unknown) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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
