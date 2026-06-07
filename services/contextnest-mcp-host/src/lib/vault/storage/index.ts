import { BlobStorageProvider } from './blob-storage-provider.js';
import { FsStorageProvider } from '@promptowl/contextnest-engine';
import type { StorageProvider } from '@promptowl/contextnest-engine';

export function createStorageProvider(vaultId?: string): StorageProvider {
  const backend = process.env.CONTEXTNEST_STORAGE ?? 'blob';

  if (backend === 'blob') {
    const prefix = process.env.CONTEXTNEST_BLOB_PREFIX;
    if (!prefix) throw new Error('CONTEXTNEST_BLOB_PREFIX env var is required when CONTEXTNEST_STORAGE=blob');
    const resolvedVaultId = vaultId ?? process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default';
    return new BlobStorageProvider({ prefix, vaultId: resolvedVaultId });
  }

  if (backend === 'fs') {
    const vaultPath = process.env.CONTEXTNEST_VAULT_PATH;
    if (!vaultPath) throw new Error('CONTEXTNEST_VAULT_PATH env var is required when CONTEXTNEST_STORAGE=fs');
    return new FsStorageProvider(vaultPath);
  }

  throw new Error(`Unknown CONTEXTNEST_STORAGE value: "${backend}"`);
}
