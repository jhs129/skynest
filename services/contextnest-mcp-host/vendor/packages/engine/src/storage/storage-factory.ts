import { FsStorageProvider } from './providers/fs-storage-provider.js';
import type { StorageProvider } from './storage-provider.js';

export interface StorageProviderConfig {
  backend: string;
  vaultPath?: string;
}

/**
 * Base factory — handles 'fs' only.
 * The 'blob' backend is registered in the host application (src/lib/vault/storage/index.ts)
 * to keep Vercel-specific dependencies out of the vendor tree.
 */
export function createStorageProvider(config: StorageProviderConfig): StorageProvider {
  if (config.backend === 'fs') {
    if (!config.vaultPath) throw new Error('vaultPath required for fs backend');
    return new FsStorageProvider(config.vaultPath);
  }
  throw new Error(`Unknown storage backend: "${config.backend}". Register custom backends in your host application.`);
}
