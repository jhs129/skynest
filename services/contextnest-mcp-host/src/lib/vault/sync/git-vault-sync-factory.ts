import type { GitVaultSyncProvider } from './git-vault-sync-provider.js';
import { GitHubVaultSyncProvider } from './providers/github-vault-sync-provider.js';
import { NoopVaultSyncProvider } from './providers/noop-vault-sync-provider.js';

export function createGitVaultSyncProvider(): GitVaultSyncProvider {
  const providerName = process.env.VAULT_SYNC_PROVIDER ?? 'github';

  if (providerName === 'none') {
    return new NoopVaultSyncProvider();
  }

  if (providerName === 'github') {
    const repo = process.env.VAULT_REPO;
    const branch = process.env.VAULT_BRANCH ?? 'main';
    if (!repo) throw new Error('VAULT_REPO env var is required');
    return new GitHubVaultSyncProvider({ repo, branch });
  }

  throw new Error(`Unknown VAULT_SYNC_PROVIDER: "${providerName}"`);
}
