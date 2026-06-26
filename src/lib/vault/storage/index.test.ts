import { describe, it, expect, afterEach, vi } from 'vitest';

// Prevent real Azure/Vercel SDK calls
vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: vi.fn(() => ({ getContainerClient: vi.fn(() => ({})) })),
}));
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: vi.fn() }));
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn(), list: vi.fn(), head: vi.fn(), get: vi.fn() }));

import { createStorageProvider } from './index.js';
import { AzureBlobStorageProvider } from './azure-blob-storage-provider.js';

describe('createStorageProvider', () => {
  afterEach(() => {
    delete process.env.CONTEXTNEST_STORAGE;
    delete process.env.AZURE_STORAGE_ACCOUNT_URL;
    delete process.env.AZURE_BLOB_CONTAINER;
    delete process.env.CONTEXTNEST_BLOB_PREFIX;
  });

  it('returns AzureBlobStorageProvider when CONTEXTNEST_STORAGE=azure-blob', () => {
    process.env.CONTEXTNEST_STORAGE = 'azure-blob';
    process.env.AZURE_STORAGE_ACCOUNT_URL = 'https://stoc360dev.blob.core.windows.net';
    const provider = createStorageProvider('resident-123');
    expect(provider).toBeInstanceOf(AzureBlobStorageProvider);
  });

  it('uses default container name "skynest" when AZURE_BLOB_CONTAINER is not set', () => {
    process.env.CONTEXTNEST_STORAGE = 'azure-blob';
    process.env.AZURE_STORAGE_ACCOUNT_URL = 'https://stoc360dev.blob.core.windows.net';
    expect(() => createStorageProvider('my-vault')).not.toThrow();
  });

  it('throws for unknown backend value', () => {
    process.env.CONTEXTNEST_STORAGE = 's3';
    expect(() => createStorageProvider()).toThrow('Unknown CONTEXTNEST_STORAGE');
  });
});
