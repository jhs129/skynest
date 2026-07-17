import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDeleteIfExists = vi.fn().mockResolvedValue({ succeeded: true });
const mockUpload = vi.fn().mockResolvedValue({});

const mockContainerClient = {
  getBlobClient: vi.fn(() => ({ deleteIfExists: mockDeleteIfExists })),
  getBlockBlobClient: vi.fn(() => ({ upload: mockUpload })),
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

import { AzureBlobVaultSyncProvider } from './azure-blob-vault-sync-provider.js';

function decodeMeta(value: string): string {
  return Buffer.from(value, 'base64').toString('utf-8');
}

describe('AzureBlobVaultSyncProvider', () => {
  let provider: AzureBlobVaultSyncProvider;
  const callOrder: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    mockUpload.mockImplementation(async () => {
      callOrder.push('upload');
      return {};
    });
    mockDeleteIfExists.mockImplementation(async () => {
      callOrder.push('deleteIfExists');
      return { succeeded: true };
    });
    provider = new AzureBlobVaultSyncProvider({
      containerName: 'skynest-vault-sync',
      vaultId: 'default',
      accountUrl: 'https://test.blob.core.windows.net',
    });
  });

  it('constructor throws with neither a connection string nor an account URL', () => {
    expect(
      () => new AzureBlobVaultSyncProvider({ containerName: 'skynest-vault-sync', vaultId: 'default' })
    ).toThrow(/requires an account URL.*or a connection string/);
  });

  describe('commitFile', () => {
    it('uploads with vault-prefixed blob name and base64-encoded metadata', async () => {
      await provider.commitFile({
        path: 'nodes/doc.md',
        content: Buffer.from('# Doc'),
        message: 'create doc',
        editedBy: 'alice@example.com',
      });

      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('default/nodes/doc.md');
      const [content, length, options] = mockUpload.mock.calls[0];
      expect(content.toString()).toBe('# Doc');
      expect(length).toBe(Buffer.from('# Doc').length);
      expect(decodeMeta(options.metadata.messageB64)).toBe('create doc');
      expect(decodeMeta(options.metadata.editedByB64)).toBe('alice@example.com');
      expect(options.metadata.editedAt).toBeDefined();
    });

    it('round-trips non-ASCII messages and editedBy values', async () => {
      await provider.commitFile({
        path: 'nodes/doc.md',
        content: Buffer.from('body'),
        message: 'créé un document 文档',
        editedBy: 'jöhn@example.com',
      });

      const options = mockUpload.mock.calls[0][2];
      expect(decodeMeta(options.metadata.messageB64)).toBe('créé un document 文档');
      expect(decodeMeta(options.metadata.editedByB64)).toBe('jöhn@example.com');
    });
  });

  describe('deleteFile', () => {
    it('uploads a zero-byte tombstone version before calling deleteIfExists', async () => {
      await provider.deleteFile({
        path: 'nodes/doc.md',
        message: 'delete doc',
        editedBy: 'alice@example.com',
      });

      expect(callOrder).toEqual(['upload', 'deleteIfExists']);
      const [content, length, options] = mockUpload.mock.calls[0];
      expect(content.length).toBe(0);
      expect(length).toBe(0);
      expect(options.metadata.tombstone).toBe('true');
      expect(decodeMeta(options.metadata.messageB64)).toBe('delete doc');
      expect(decodeMeta(options.metadata.editedByB64)).toBe('alice@example.com');
      expect(mockContainerClient.getBlobClient).toHaveBeenCalledWith('default/nodes/doc.md');
    });
  });
});
