import { describe, it, expect, beforeEach } from 'vitest';
import { createGitVaultSyncProvider } from './git-vault-sync-factory.js';
import { GitHubVaultSyncProvider } from './providers/github-vault-sync-provider.js';

describe('createGitVaultSyncProvider', () => {
  beforeEach(() => {
    delete process.env.VAULT_SYNC_PROVIDER;
    delete process.env.VAULT_REPO;
    delete process.env.VAULT_BRANCH;
  });

  it('returns a GitHubVaultSyncProvider when VAULT_SYNC_PROVIDER is "github"', () => {
    process.env.VAULT_SYNC_PROVIDER = 'github';
    process.env.VAULT_REPO = 'owner/repo';
    process.env.VAULT_BRANCH = 'main';
    const provider = createGitVaultSyncProvider();
    expect(provider).toBeInstanceOf(GitHubVaultSyncProvider);
  });

  it('uses "github" as the default provider', () => {
    process.env.VAULT_REPO = 'owner/repo';
    const provider = createGitVaultSyncProvider();
    expect(provider).toBeInstanceOf(GitHubVaultSyncProvider);
  });

  it('throws for unknown provider', () => {
    process.env.VAULT_SYNC_PROVIDER = 'unknown-provider';
    expect(() => createGitVaultSyncProvider()).toThrow('Unknown VAULT_SYNC_PROVIDER');
  });
});
