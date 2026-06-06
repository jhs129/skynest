import { describe, it, expect } from 'vitest';

describe('createGitVaultSyncProvider', () => {
  it('returns a GitHubVaultSyncProvider when provider is "github"', async () => {
    process.env.VAULT_SYNC_PROVIDER = 'github';
    process.env.VAULT_REPO = 'owner/repo';
    process.env.VAULT_BRANCH = 'main';
    const { createGitVaultSyncProvider } = await import('./git-vault-sync-factory.js');
    const provider = await createGitVaultSyncProvider();
    expect(provider.constructor.name).toBe('GitHubVaultSyncProvider');
    expect(provider).toHaveProperty('commitFile');
    expect(provider).toHaveProperty('deleteFile');
  });

  it('throws for unknown provider', async () => {
    process.env.VAULT_SYNC_PROVIDER = 'unknown-provider';
    const { createGitVaultSyncProvider } = await import('./git-vault-sync-factory.js');
    await expect(createGitVaultSyncProvider()).rejects.toThrow('Unknown VAULT_SYNC_PROVIDER');
  });
});
