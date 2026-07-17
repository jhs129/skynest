import type { VaultSyncProvider } from '../vault-sync-provider.js';

/** No-op sync provider for local dev (VAULT_SYNC_PROVIDER=none). Writes go only to FsStorageProvider. */
export class NoopVaultSyncProvider implements VaultSyncProvider {
  async commitFile(): Promise<void> {}
  async deleteFile(): Promise<void> {}
}
