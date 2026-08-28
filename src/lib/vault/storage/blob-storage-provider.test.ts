import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlobStorageProvider } from './blob-storage-provider.js';
import { StorageConflictError } from '@promptowl/contextnest-engine';

// Mock @vercel/blob
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
  head: vi.fn(),
  get: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {
    constructor() { super('Blob not found'); this.name = 'BlobNotFoundError'; }
  },
}));

import { put, del, list, head, get, BlobNotFoundError } from '@vercel/blob';
const mockPut = vi.mocked(put);
const mockDel = vi.mocked(del);
const mockList = vi.mocked(list);
const mockHead = vi.mocked(head);
const mockGet = vi.mocked(get);

describe('BlobStorageProvider', () => {
  let provider: BlobStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BlobStorageProvider({ prefix: 'vault', vaultId: 'default' });
  });

  it('read returns null when blob does not exist', async () => {
    mockGet.mockResolvedValue(null);
    expect(await provider.read('nodes/doc.md')).toBeNull();
  });

  it('read fetches blob content as Buffer', async () => {
    const content = 'hello';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });
    mockGet.mockResolvedValue({
      statusCode: 200,
      stream,
      headers: new Headers(),
      blob: {
        url: 'https://store.blob.vercel-storage.com/vault/default/nodes/doc.md',
        downloadUrl: 'https://store.blob.vercel-storage.com/vault/default/nodes/doc.md',
        pathname: 'vault/default/nodes/doc.md',
        contentType: 'text/plain',
        contentDisposition: '',
        cacheControl: '',
        uploadedAt: new Date(),
        etag: 'abc',
        size: 5,
      },
    });
    const result = await provider.read('nodes/doc.md');
    expect(result?.toString()).toBe('hello');
    expect(mockGet).toHaveBeenCalledWith('vault/default/nodes/doc.md', { access: 'private', useCache: false });
  });

  it('write calls put with correct key, access, and allowOverwrite', async () => {
    mockPut.mockResolvedValue({ url: 'https://example.com/vault/default/nodes/doc.md', pathname: 'vault/default/nodes/doc.md', contentType: 'application/octet-stream', contentDisposition: '', downloadUrl: 'https://example.com/vault/default/nodes/doc.md', etag: 'abc' });
    await provider.write('nodes/doc.md', Buffer.from('hello'));
    expect(mockPut).toHaveBeenCalledWith(
      'vault/default/nodes/doc.md',
      expect.any(Buffer),
      { access: 'private', addRandomSuffix: false, allowOverwrite: true }
    );
  });

  it('delete lists then deletes by url', async () => {
    const url = 'https://store.blob.vercel-storage.com/vault/default/nodes/doc.md';
    mockList.mockResolvedValue({ blobs: [{ url, pathname: 'vault/default/nodes/doc.md', size: 5, uploadedAt: new Date(), downloadUrl: url, etag: 'abc' }], cursor: undefined, hasMore: false });
    mockDel.mockResolvedValue(undefined);
    await provider.delete('nodes/doc.md');
    expect(mockDel).toHaveBeenCalledWith([url]);
  });

  it('list returns vault-relative paths (prefix stripped)', async () => {
    mockList.mockResolvedValue({
      blobs: [
        { url: 'u1', pathname: 'vault/default/nodes/a.md', size: 1, uploadedAt: new Date(), downloadUrl: 'u1', etag: 'a' },
        { url: 'u2', pathname: 'vault/default/nodes/b.md', size: 1, uploadedAt: new Date(), downloadUrl: 'u2', etag: 'b' },
      ],
      cursor: undefined,
      hasMore: false,
    });
    const result = await provider.list('nodes/');
    expect(result).toEqual(['nodes/a.md', 'nodes/b.md']);
  });

  it('exists returns false for BlobNotFoundError', async () => {
    mockHead.mockRejectedValue(new BlobNotFoundError());
    expect(await provider.exists('nodes/missing.md')).toBe(false);
  });

  it('exists returns true when blob is found', async () => {
    mockHead.mockResolvedValue({ url: 'u', pathname: 'vault/default/nodes/doc.md', size: 5, uploadedAt: new Date(), downloadUrl: 'u', contentType: 'text/plain', cacheControl: '', contentDisposition: '', etag: 'abc' });
    expect(await provider.exists('nodes/doc.md')).toBe(true);
  });

  it('stat returns size and mtimeMs from head()', async () => {
    const uploadedDate = new Date('2026-01-01T00:00:00Z');
    mockHead.mockResolvedValue({
      url: 'u',
      pathname: 'vault/default/nodes/doc.md',
      size: 42,
      uploadedAt: uploadedDate,
      downloadUrl: 'u',
      contentType: 'text/plain',
      cacheControl: '',
      contentDisposition: '',
      etag: 'abc',
    });
    const info = await provider.stat('nodes/doc.md');
    expect(info).toEqual({ size: 42, mtimeMs: uploadedDate.getTime() });
  });

  it('stat returns null when head() throws BlobNotFoundError', async () => {
    mockHead.mockRejectedValue(new BlobNotFoundError());
    expect(await provider.stat('missing.md')).toBeNull();
  });

  it('writeExclusive throws StorageConflictError when the blob already exists', async () => {
    mockHead.mockResolvedValue({
      url: 'u',
      pathname: 'vault/default/nodes/doc.md',
      size: 5,
      uploadedAt: new Date(),
      downloadUrl: 'u',
      contentType: 'text/plain',
      cacheControl: '',
      contentDisposition: '',
      etag: 'abc',
    });
    await expect(provider.writeExclusive('nodes/doc.md', Buffer.from('x'))).rejects.toBeInstanceOf(StorageConflictError);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('writeExclusive writes when the blob does not exist', async () => {
    mockHead.mockRejectedValue(new BlobNotFoundError());
    mockPut.mockResolvedValue({
      url: 'https://example.com/vault/default/nodes/doc.md',
      pathname: 'vault/default/nodes/doc.md',
      contentType: 'application/octet-stream',
      contentDisposition: '',
      downloadUrl: 'https://example.com/vault/default/nodes/doc.md',
      etag: 'abc',
    });
    const data = Buffer.from('x');
    await provider.writeExclusive('nodes/doc.md', data);
    expect(mockPut).toHaveBeenCalledWith(
      'vault/default/nodes/doc.md',
      data,
      { access: 'private', addRandomSuffix: false, allowOverwrite: true }
    );
  });

  it('appendOrCreate writes header+entry when the file does not exist', async () => {
    mockGet.mockResolvedValue(null);
    mockPut.mockResolvedValue({
      url: 'https://example.com/vault/default/log.yaml',
      pathname: 'vault/default/log.yaml',
      contentType: 'application/octet-stream',
      contentDisposition: '',
      downloadUrl: 'https://example.com/vault/default/log.yaml',
      etag: 'abc',
    });
    await provider.appendOrCreate('log.yaml', 'HEADER\n', 'first\n');
    expect(mockPut).toHaveBeenCalledWith(
      'vault/default/log.yaml',
      Buffer.from('HEADER\nfirst\n', 'utf-8'),
      { access: 'private', addRandomSuffix: false, allowOverwrite: true }
    );
  });

  it('appendOrCreate appends entry when the file exists', async () => {
    const existingContent = Buffer.from('HEADER\nfirst\n', 'utf-8');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(existingContent);
        controller.close();
      },
    });
    mockGet.mockResolvedValue({
      statusCode: 200,
      stream,
      headers: new Headers(),
      blob: {
        url: 'https://store.blob.vercel-storage.com/vault/default/log.yaml',
        downloadUrl: 'https://store.blob.vercel-storage.com/vault/default/log.yaml',
        pathname: 'vault/default/log.yaml',
        contentType: 'text/yaml',
        contentDisposition: '',
        cacheControl: '',
        uploadedAt: new Date(),
        etag: 'abc',
        size: existingContent.length,
      },
    });
    mockPut.mockResolvedValue({
      url: 'https://example.com/vault/default/log.yaml',
      pathname: 'vault/default/log.yaml',
      contentType: 'application/octet-stream',
      contentDisposition: '',
      downloadUrl: 'https://example.com/vault/default/log.yaml',
      etag: 'abc',
    });
    await provider.appendOrCreate('log.yaml', 'HEADER\n', 'second\n');
    expect(mockPut).toHaveBeenCalledWith(
      'vault/default/log.yaml',
      Buffer.from('HEADER\nfirst\nsecond\n', 'utf-8'),
      { access: 'private', addRandomSuffix: false, allowOverwrite: true }
    );
  });

  it('appendOrCreate writes header+entry when the file exists but is zero bytes', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    mockGet.mockResolvedValue({
      statusCode: 200,
      stream,
      headers: new Headers(),
      blob: {
        url: 'https://store.blob.vercel-storage.com/vault/default/log.yaml',
        downloadUrl: 'https://store.blob.vercel-storage.com/vault/default/log.yaml',
        pathname: 'vault/default/log.yaml',
        contentType: 'text/yaml',
        contentDisposition: '',
        cacheControl: '',
        uploadedAt: new Date(),
        etag: 'abc',
        size: 0,
      },
    });
    mockPut.mockResolvedValue({
      url: 'https://example.com/vault/default/log.yaml',
      pathname: 'vault/default/log.yaml',
      contentType: 'application/octet-stream',
      contentDisposition: '',
      downloadUrl: 'https://example.com/vault/default/log.yaml',
      etag: 'abc',
    });
    await provider.appendOrCreate('log.yaml', 'HEADER\n', 'first\n');
    expect(mockPut).toHaveBeenCalledWith(
      'vault/default/log.yaml',
      Buffer.from('HEADER\nfirst\n', 'utf-8'),
      { access: 'private', addRandomSuffix: false, allowOverwrite: true }
    );
  });
});
