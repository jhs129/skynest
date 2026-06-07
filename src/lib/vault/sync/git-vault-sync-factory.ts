import type { GitVaultSyncProvider } from './git-vault-sync-provider.js';
import { GitHubVaultSyncProvider } from './providers/github-vault-sync-provider.js';
import { NoopVaultSyncProvider } from './providers/noop-vault-sync-provider.js';

function envForVault(key: string, vaultId: string): string | undefined {
  const suffix = vaultId.toUpperCase().replace(/-/g, '_');
  return process.env[`${key}_${suffix}`] ?? process.env[key];
}

export function createGitVaultSyncProvider(vaultId: string = 'default'): GitVaultSyncProvider {
  const providerName = envForVault('VAULT_SYNC_PROVIDER', vaultId) ?? 'github';

  if (providerName === 'none') {
    return new NoopVaultSyncProvider();
  }

  if (providerName === 'github') {
    const repo = envForVault('VAULT_REPO', vaultId);
    const branch = envForVault('VAULT_BRANCH', vaultId) ?? 'main';
    if (!repo) throw new Error(`VAULT_REPO env var is required (tried VAULT_REPO_${vaultId.toUpperCase().replace(/-/g, '_')} and VAULT_REPO)`);
    return new GitHubVaultSyncProvider({ repo, branch });
  }

  throw new Error(`Unknown VAULT_SYNC_PROVIDER: "${providerName}"`);
}
