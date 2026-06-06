import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./storage/index.js', () => ({
  createStorageProvider: vi.fn(() => ({ read: vi.fn(), write: vi.fn(), delete: vi.fn(), deleteDir: vi.fn(), rename: vi.fn(), list: vi.fn(), exists: vi.fn() })),
}));

vi.mock('./sync/git-vault-sync-factory.js', () => ({
  createGitVaultSyncProvider: vi.fn(() => ({ commitFile: vi.fn(), deleteFile: vi.fn() })),
}));

vi.mock('@promptowl/contextnest-engine', () => ({
  NestStorage: vi.fn().mockImplementation(() => ({})),
}));

describe('createEngine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('constructs a NestStorage with the storage provider', async () => {
    const { createEngine } = await import('./index.js');
    const { NestStorage } = await import('@promptowl/contextnest-engine');
    const { createStorageProvider } = await import('./storage/index.js');

    createEngine('ghp_testtoken');

    expect(createStorageProvider).toHaveBeenCalledOnce();
    expect(NestStorage).toHaveBeenCalledWith(expect.objectContaining({ read: expect.any(Function) }));
  });

  it('returns an object with storage and sync', async () => {
    const { createEngine } = await import('./index.js');
    const result = createEngine('ghp_testtoken');
    expect(result).toHaveProperty('storage');
    expect(result).toHaveProperty('sync');
  });
});
