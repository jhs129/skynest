import type { GitVaultSyncProvider } from './git-vault-sync-provider.js';

export async function createGitVaultSyncProvider(): Promise<GitVaultSyncProvider> {
  const providerName = process.env.VAULT_SYNC_PROVIDER ?? 'github';

  if (providerName === 'github') {
    const { GitHubVaultSyncProvider } = await import('./providers/github-vault-sync-provider.js');
    const repo = process.env.VAULT_REPO;
    const branch = process.env.VAULT_BRANCH ?? 'main';
    if (!repo) throw new Error('VAULT_REPO env var is required');
    return new GitHubVaultSyncProvider({ repo, branch });
  }

  throw new Error(`Unknown VAULT_SYNC_PROVIDER: "${providerName}"`);
}
