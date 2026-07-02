import type { VaultSyncProvider } from './vault-sync-provider.js';
import { GitHubVaultSyncProvider } from './providers/github-vault-sync-provider.js';
import { AzureBlobVaultSyncProvider } from './providers/azure-blob-vault-sync-provider.js';
import { NoopVaultSyncProvider } from './providers/noop-vault-sync-provider.js';

function envForVault(key: string, vaultId: string): string | undefined {
  const suffix = vaultId.toUpperCase().replace(/-/g, '_');
  return process.env[`${key}_${suffix}`] ?? process.env[key];
}

export function createVaultSyncProvider(vaultId: string = 'default'): VaultSyncProvider {
  const authProvider = process.env.AUTH_PROVIDER ?? 'github';
  const hasRepo = !!envForVault('VAULT_REPO', vaultId);
  const hasAzureSync = !!(
    envForVault('VAULT_AZURE_STORAGE_CONNECTION_STRING', vaultId) ??
    envForVault('VAULT_AZURE_STORAGE_ACCOUNT_URL', vaultId)
  );

  // Default order: 'github' only when GitHub is also the active auth mode (a
  // repo-scoped user token must exist to write commits); otherwise 'azure' if
  // configured; otherwise 'none'. Never silently default to 'github' under
  // AUTH_PROVIDER=entra, even if a stray VAULT_REPO is left set.
  const defaultProvider =
    authProvider === 'github' && hasRepo ? 'github' : hasAzureSync ? 'azure' : 'none';
  const providerName = envForVault('VAULT_SYNC_PROVIDER', vaultId) ?? defaultProvider;

  if (providerName === 'github' && authProvider !== 'github') {
    throw new Error(
      'VAULT_SYNC_PROVIDER=github requires AUTH_PROVIDER=github — GitHub-authenticated users provide the repo-scoped token needed for git commits. Set VAULT_SYNC_PROVIDER=azure or none, or switch AUTH_PROVIDER to github.'
    );
  }

  if (providerName === 'none') {
    return new NoopVaultSyncProvider();
  }

  if (providerName === 'github') {
    const repo = envForVault('VAULT_REPO', vaultId);
    const branch = envForVault('VAULT_BRANCH', vaultId) ?? 'main';
    if (!repo) throw new Error(`VAULT_REPO env var is required (tried VAULT_REPO_${vaultId.toUpperCase().replace(/-/g, '_')} and VAULT_REPO)`);
    return new GitHubVaultSyncProvider({ repo, branch });
  }

  if (providerName === 'azure') {
    const connectionString = envForVault('VAULT_AZURE_STORAGE_CONNECTION_STRING', vaultId);
    const accountUrl = envForVault('VAULT_AZURE_STORAGE_ACCOUNT_URL', vaultId);
    if (!connectionString && !accountUrl) {
      throw new Error(
        'VAULT_AZURE_STORAGE_ACCOUNT_URL (managed identity) or VAULT_AZURE_STORAGE_CONNECTION_STRING is required for VAULT_SYNC_PROVIDER=azure'
      );
    }
    const containerName = envForVault('VAULT_AZURE_CONTAINER', vaultId) ?? 'skynest-vault-sync';
    return new AzureBlobVaultSyncProvider({ containerName, vaultId, connectionString, accountUrl });
  }

  throw new Error(`Unknown VAULT_SYNC_PROVIDER: "${providerName}"`);
}
