import { describe, it, expect, afterEach, vi } from 'vitest';

// Prevent real Azure/Vercel SDK calls
vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: vi.fn(() => ({ getContainerClient: vi.fn(() => ({})) })),
}));
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: vi.fn() }));
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn(), list: vi.fn(), head: vi.fn(), get: vi.fn() }));

import { createStorageProvider } from './index.js';
import { AzureBlobStorageProvider } from './azure-blob-storage-provider.js';
import { BlobStorageProvider } from './blob-storage-provider.js';

describe('createStorageProvider', () => {
  afterEach(() => {
    delete process.env.CONTEXTNEST_STORAGE;
    delete process.env.CONTEXTNEST_STORAGE_PROVIDER;
    delete process.env.AZURE_STORAGE_ACCOUNT_URL;
    delete process.env.AZURE_BLOB_CONTAINER;
    delete process.env.CONTEXTNEST_BLOB_PREFIX;
  });

  it('defaults to vercel provider when CONTEXTNEST_STORAGE=blob and CONTEXTNEST_STORAGE_PROVIDER is unset', () => {
    process.env.CONTEXTNEST_STORAGE = 'blob';
    process.env.CONTEXTNEST_BLOB_PREFIX = 'test-prefix';
    const provider = createStorageProvider('my-vault');
    expect(provider).toBeInstanceOf(BlobStorageProvider);
  });

  it('returns AzureBlobStorageProvider when CONTEXTNEST_STORAGE=blob and CONTEXTNEST_STORAGE_PROVIDER=azure', () => {
    process.env.CONTEXTNEST_STORAGE = 'blob';
    process.env.CONTEXTNEST_STORAGE_PROVIDER = 'azure';
    process.env.AZURE_STORAGE_ACCOUNT_URL = 'https://sttestskynest.blob.core.windows.net';
    const provider = createStorageProvider('resident-123');
    expect(provider).toBeInstanceOf(AzureBlobStorageProvider);
  });

  it('uses default container name "skynest" when AZURE_BLOB_CONTAINER is not set', () => {
    process.env.CONTEXTNEST_STORAGE = 'blob';
    process.env.CONTEXTNEST_STORAGE_PROVIDER = 'azure';
    process.env.AZURE_STORAGE_ACCOUNT_URL = 'https://sttestskynest.blob.core.windows.net';
    expect(() => createStorageProvider('my-vault')).not.toThrow();
  });

  it('throws for unknown CONTEXTNEST_STORAGE_PROVIDER', () => {
    process.env.CONTEXTNEST_STORAGE = 'blob';
    process.env.CONTEXTNEST_STORAGE_PROVIDER = 's3';
    expect(() => createStorageProvider()).toThrow('Unknown CONTEXTNEST_STORAGE_PROVIDER value: "s3"');
  });

  it('throws for unknown CONTEXTNEST_STORAGE value', () => {
    process.env.CONTEXTNEST_STORAGE = 'database';
    expect(() => createStorageProvider()).toThrow('Unknown CONTEXTNEST_STORAGE value: "database"');
  });
});
