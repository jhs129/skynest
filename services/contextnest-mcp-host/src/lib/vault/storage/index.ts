import { BlobStorageProvider } from './blob-storage-provider.js';
import { FsStorageProvider } from '@promptowl/contextnest-engine';
import type { StorageProvider } from '@promptowl/contextnest-engine';

export function createStorageProvider(): StorageProvider {
  const backend = process.env.CONTEXTNEST_STORAGE ?? 'blob';

  if (backend === 'blob') {
    const prefix = process.env.CONTEXTNEST_BLOB_PREFIX;
    if (!prefix) throw new Error('CONTEXTNEST_BLOB_PREFIX env var is required when CONTEXTNEST_STORAGE=blob');
    return new BlobStorageProvider({ prefix });
  }

  if (backend === 'fs') {
    const vaultPath = process.env.CONTEXTNEST_VAULT_PATH;
    if (!vaultPath) throw new Error('CONTEXTNEST_VAULT_PATH env var is required when CONTEXTNEST_STORAGE=fs');
    return new FsStorageProvider(vaultPath);
  }

  throw new Error(`Unknown CONTEXTNEST_STORAGE value: "${backend}"`);
}
