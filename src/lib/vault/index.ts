import { NestStorage } from '@promptowl/contextnest-engine';
import { createStorageProvider } from './storage/index.js';
import { createGitVaultSyncProvider } from './sync/git-vault-sync-factory.js';
import type { GitVaultSyncProvider } from './sync/git-vault-sync-provider.js';

export interface VaultEngine {
  storage: NestStorage;
  sync: GitVaultSyncProvider;
  userToken: string;
}

/**
 * Create a fully configured vault engine for a single request.
 * Each tool call gets its own instance — stateless, correct attribution per call.
 * Pass vaultId to select a specific vault in a multi-repo setup.
 */
export function createEngine(userToken: string, vaultId?: string): VaultEngine {
  const provider = createStorageProvider(vaultId);
  const storage = new NestStorage(provider);
  const sync = createGitVaultSyncProvider(vaultId);
  return { storage, sync, userToken };
}
