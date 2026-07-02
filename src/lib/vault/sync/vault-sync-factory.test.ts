import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContainerClient = {
  getBlobClient: vi.fn(() => ({ deleteIfExists: vi.fn() })),
  getBlockBlobClient: vi.fn(() => ({ upload: vi.fn() })),
};

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: Object.assign(
    vi.fn(() => ({ getContainerClient: vi.fn(() => mockContainerClient) })),
    { fromConnectionString: vi.fn(() => ({ getContainerClient: vi.fn(() => mockContainerClient) })) }
  ),
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(),
}));

import { createVaultSyncProvider } from './vault-sync-factory.js';
import { GitHubVaultSyncProvider } from './providers/github-vault-sync-provider.js';
import { AzureBlobVaultSyncProvider } from './providers/azure-blob-vault-sync-provider.js';
import { NoopVaultSyncProvider } from './providers/noop-vault-sync-provider.js';

describe('createVaultSyncProvider', () => {
  beforeEach(() => {
    delete process.env.AUTH_PROVIDER;
    delete process.env.VAULT_SYNC_PROVIDER;
    delete process.env.VAULT_REPO;
    delete process.env.VAULT_BRANCH;
    delete process.env.VAULT_AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.VAULT_AZURE_STORAGE_ACCOUNT_URL;
    delete process.env.VAULT_AZURE_CONTAINER;
  });

  it('returns a GitHubVaultSyncProvider when VAULT_SYNC_PROVIDER is "github"', () => {
    process.env.VAULT_SYNC_PROVIDER = 'github';
    process.env.VAULT_REPO = 'owner/repo';
    process.env.VAULT_BRANCH = 'main';
    const provider = createVaultSyncProvider();
    expect(provider).toBeInstanceOf(GitHubVaultSyncProvider);
  });

  it('defaults to github when VAULT_REPO is set, AUTH_PROVIDER is github (or unset), and VAULT_SYNC_PROVIDER is unset', () => {
    process.env.VAULT_REPO = 'owner/repo';
    const provider = createVaultSyncProvider();
    expect(provider).toBeInstanceOf(GitHubVaultSyncProvider);
  });

  it('defaults to noop when nothing is configured', () => {
    const provider = createVaultSyncProvider();
    expect(provider).toBeInstanceOf(NoopVaultSyncProvider);
  });

  it('explicit VAULT_SYNC_PROVIDER=none overrides even when VAULT_REPO is set', () => {
    process.env.VAULT_REPO = 'owner/repo';
    process.env.VAULT_SYNC_PROVIDER = 'none';
    const provider = createVaultSyncProvider();
    expect(provider).toBeInstanceOf(NoopVaultSyncProvider);
  });

  it('throws for unknown provider', () => {
    process.env.VAULT_SYNC_PROVIDER = 'unknown-provider';
    expect(() => createVaultSyncProvider()).toThrow('Unknown VAULT_SYNC_PROVIDER');
  });

  it('throws when VAULT_SYNC_PROVIDER=github is explicitly requested under AUTH_PROVIDER=entra', () => {
    process.env.AUTH_PROVIDER = 'entra';
    process.env.VAULT_SYNC_PROVIDER = 'github';
    process.env.VAULT_REPO = 'owner/repo';
    expect(() => createVaultSyncProvider()).toThrow(
      /VAULT_SYNC_PROVIDER=github requires AUTH_PROVIDER=github/
    );
  });

  it('never silently defaults to github under AUTH_PROVIDER=entra, even with a leftover VAULT_REPO', () => {
    process.env.AUTH_PROVIDER = 'entra';
    process.env.VAULT_REPO = 'owner/repo';
    const provider = createVaultSyncProvider();
    expect(provider).toBeInstanceOf(NoopVaultSyncProvider);
  });

  it('defaults to azure under AUTH_PROVIDER=entra when Azure sync env is configured', () => {
    process.env.AUTH_PROVIDER = 'entra';
    process.env.VAULT_AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    const provider = createVaultSyncProvider();
    expect(provider).toBeInstanceOf(AzureBlobVaultSyncProvider);
  });

  it('returns an AzureBlobVaultSyncProvider when VAULT_SYNC_PROVIDER is "azure"', () => {
    process.env.VAULT_SYNC_PROVIDER = 'azure';
    process.env.VAULT_AZURE_STORAGE_ACCOUNT_URL = 'https://test.blob.core.windows.net';
    const provider = createVaultSyncProvider();
    expect(provider).toBeInstanceOf(AzureBlobVaultSyncProvider);
  });

  it('throws when azure is selected with neither a connection string nor an account URL', () => {
    process.env.VAULT_SYNC_PROVIDER = 'azure';
    expect(() => createVaultSyncProvider()).toThrow(
      /VAULT_AZURE_STORAGE_ACCOUNT_URL.*or VAULT_AZURE_STORAGE_CONNECTION_STRING is required/
    );
  });
});
