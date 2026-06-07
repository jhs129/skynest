// Persistent OAuth client registry backed by Vercel Blob.
// Each client is stored at oauth-clients/{clientId}.json so records survive
// across serverless function instances (the previous in-memory Map did not).

import { put, get, BlobNotFoundError } from '@vercel/blob';

export interface OAuthClientRecord {
  name: string;
  redirectUris: string[];
}

function blobKey(clientId: string): string {
  return `oauth-clients/${clientId}.json`;
}

export async function registerClient(clientId: string, record: OAuthClientRecord): Promise<void> {
  const data = Buffer.from(JSON.stringify(record), 'utf8');
  await put(blobKey(clientId), data, { access: 'private', addRandomSuffix: false, allowOverwrite: true });
}

export async function getClient(clientId: string): Promise<OAuthClientRecord | undefined> {
  try {
    const result = await get(blobKey(clientId), { access: 'private' });
    if (!result?.stream) return undefined;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as OAuthClientRecord;
  } catch (err: unknown) {
    if (err instanceof BlobNotFoundError) return undefined;
    throw err;
  }
}
