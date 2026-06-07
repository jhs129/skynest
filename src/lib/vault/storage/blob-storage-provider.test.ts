import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlobStorageProvider } from './blob-storage-provider.js';

// Mock @vercel/blob
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
  head: vi.fn(),
}));

import { put, del, list, head } from '@vercel/blob';
const mockPut = vi.mocked(put);
const mockDel = vi.mocked(del);
const mockList = vi.mocked(list);
const mockHead = vi.mocked(head);

describe('BlobStorageProvider', () => {
  let provider: BlobStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BlobStorageProvider({ prefix: 'vault' });
  });

  it('read returns null when blob does not exist', async () => {
    mockHead.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    expect(await provider.read('nodes/doc.md')).toBeNull();
  });

  it('read fetches blob content as Buffer', async () => {
    const url = 'https://store.blob.vercel-storage.com/vault/nodes/doc.md';
    mockHead.mockResolvedValue({ url, pathname: 'vault/nodes/doc.md', size: 5, uploadedAt: new Date(), downloadUrl: url, contentType: 'text/plain', cacheControl: '', contentDisposition: '' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array(Buffer.from('hello')).buffer,
    }) as unknown as typeof fetch;
    const result = await provider.read('nodes/doc.md');
    expect(result?.toString()).toBe('hello');
  });

  it('write calls put with correct key and access', async () => {
    mockPut.mockResolvedValue({ url: 'https://example.com/vault/nodes/doc.md', pathname: 'vault/nodes/doc.md', contentType: 'application/octet-stream', contentDisposition: '', downloadUrl: 'https://example.com/vault/nodes/doc.md' });
    await provider.write('nodes/doc.md', Buffer.from('hello'));
    expect(mockPut).toHaveBeenCalledWith(
      'vault/nodes/doc.md',
      expect.any(Uint8Array),
      { access: 'private', addRandomSuffix: false }
    );
  });

  it('delete lists then deletes by url', async () => {
    const url = 'https://store.blob.vercel-storage.com/vault/nodes/doc.md';
    mockList.mockResolvedValue({ blobs: [{ url, pathname: 'vault/nodes/doc.md', size: 5, uploadedAt: new Date(), downloadUrl: url }], cursor: undefined, hasMore: false });
    mockDel.mockResolvedValue(undefined);
    await provider.delete('nodes/doc.md');
    expect(mockDel).toHaveBeenCalledWith([url]);
  });

  it('list returns vault-relative paths (prefix stripped)', async () => {
    mockList.mockResolvedValue({
      blobs: [
        { url: 'u1', pathname: 'vault/nodes/a.md', size: 1, uploadedAt: new Date(), downloadUrl: 'u1' },
        { url: 'u2', pathname: 'vault/nodes/b.md', size: 1, uploadedAt: new Date(), downloadUrl: 'u2' },
      ],
      cursor: undefined,
      hasMore: false,
    });
    const result = await provider.list('nodes/');
    expect(result).toEqual(['nodes/a.md', 'nodes/b.md']);
  });
});
