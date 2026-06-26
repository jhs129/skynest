import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Azure SDK before importing the module under test
const mockDeleteIfExists = vi.fn().mockResolvedValue({ succeeded: true });
const mockDownload = vi.fn();
const mockUpload = vi.fn().mockResolvedValue({});
const mockExists = vi.fn();
const mockBlobItems: { name: string }[] = [];

const mockContainerClient = {
  getBlobClient: vi.fn(() => ({
    download: mockDownload,
    deleteIfExists: mockDeleteIfExists,
    exists: mockExists,
  })),
  getBlockBlobClient: vi.fn(() => ({
    upload: mockUpload,
  })),
  listBlobsFlat: vi.fn(() =>
    (async function* () {
      for (const item of mockBlobItems) yield item;
    })()
  ),
};

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: vi.fn(() => ({
    getContainerClient: vi.fn(() => mockContainerClient),
  })),
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(),
}));

import { AzureBlobStorageProvider } from './azure-blob-storage-provider.js';

describe('AzureBlobStorageProvider', () => {
  let provider: AzureBlobStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBlobItems.length = 0;
    // Re-attach listBlobsFlat implementation after clearAllMocks resets call counts.
    // listBlobsFlat needs to return a fresh async iterator each test using current mockBlobItems.
    mockContainerClient.listBlobsFlat.mockImplementation(() =>
      (async function* () {
        for (const item of mockBlobItems) yield item;
      })()
    );
    process.env.AZURE_STORAGE_ACCOUNT_URL = 'https://test.blob.core.windows.net';
    provider = new AzureBlobStorageProvider({ containerName: 'skynest', vaultId: 'default' });
  });

  it('read returns null when blob not found (404)', async () => {
    const err = Object.assign(new Error('Not found'), { statusCode: 404 });
    mockDownload.mockRejectedValue(err);
    expect(await provider.read('nodes/doc.md')).toBeNull();
  });

  it('read fetches blob content as Buffer', async () => {
    const content = Buffer.from('hello');
    const { Readable } = await import('stream');
    const stream = Readable.from([content]);
    mockDownload.mockResolvedValue({ readableStreamBody: stream });
    const result = await provider.read('nodes/doc.md');
    expect(result?.toString()).toBe('hello');
    expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith('default/nodes/doc.md');
  });

  it('write uploads with correct blob name and length', async () => {
    const data = Buffer.from('hello');
    await provider.write('nodes/doc.md', data);
    expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('default/nodes/doc.md');
    expect(mockUpload).toHaveBeenCalledWith(data, 5);
  });

  it('delete calls deleteIfExists with correct blob name', async () => {
    await provider.delete('nodes/doc.md');
    expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith('default/nodes/doc.md');
    expect(mockDeleteIfExists).toHaveBeenCalled();
  });

  it('deleteDir deletes all blobs with matching prefix', async () => {
    mockBlobItems.push(
      { name: 'default/nodes/a.md' },
      { name: 'default/nodes/b.md' }
    );
    await provider.deleteDir('nodes/');
    expect(mockDeleteIfExists).toHaveBeenCalledTimes(2);
  });

  it('rename reads, writes to new path, deletes old path', async () => {
    const content = Buffer.from('hello');
    const { Readable } = await import('stream');
    mockDownload.mockResolvedValue({ readableStreamBody: Readable.from([content]) });
    await provider.rename('nodes/old.md', 'nodes/new.md');
    expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('default/nodes/new.md');
    expect(mockUpload).toHaveBeenCalled();
    expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith('default/nodes/old.md');
    expect(mockDeleteIfExists).toHaveBeenCalled();
  });

  it('list returns vault-relative paths sorted', async () => {
    mockBlobItems.push(
      { name: 'default/nodes/b.md' },
      { name: 'default/nodes/a.md' }
    );
    const result = await provider.list('nodes/');
    expect(result).toEqual(['nodes/a.md', 'nodes/b.md']);
  });

  it('list filters by suffix when pattern ends with concrete extension', async () => {
    mockBlobItems.push(
      { name: 'default/.versions/doc/history.yaml' },
      { name: 'default/.versions/doc/v1.md' }
    );
    const result = await provider.list('**/.versions/*/history.yaml');
    expect(result).toEqual(['.versions/doc/history.yaml']);
  });

  it('list returns all results when pattern ends with wildcard', async () => {
    mockBlobItems.push(
      { name: 'default/nodes/a.md' },
      { name: 'default/nodes/b.md' }
    );
    const result = await provider.list('nodes/*');
    expect(result).toEqual(['nodes/a.md', 'nodes/b.md']);
  });

  it('exists returns false when blob absent', async () => {
    mockExists.mockResolvedValue(false);
    expect(await provider.exists('nodes/missing.md')).toBe(false);
    expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith('default/nodes/missing.md');
  });

  it('exists returns true when blob present', async () => {
    mockExists.mockResolvedValue(true);
    expect(await provider.exists('nodes/doc.md')).toBe(true);
  });
});
