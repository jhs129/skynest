import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageProvider } from '../storage/providers/fs-storage-provider.js';
import { StorageConflictError } from '../storage/storage-errors.js';

let dir: string;
let provider: FsStorageProvider;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cn-test-'));
  provider = new FsStorageProvider(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('FsStorageProvider', () => {
  it('returns null for a missing file', async () => {
    expect(await provider.read('nodes/missing.md')).toBeNull();
  });

  it('round-trips write + read', async () => {
    await provider.write('nodes/doc.md', Buffer.from('hello'));
    const result = await provider.read('nodes/doc.md');
    expect(result?.toString()).toBe('hello');
  });

  it('creates parent directories on write', async () => {
    await provider.write('deep/nested/doc.md', Buffer.from('x'));
    expect(await provider.exists('deep/nested/doc.md')).toBe(true);
  });

  it('delete removes a file', async () => {
    await provider.write('nodes/doc.md', Buffer.from('x'));
    await provider.delete('nodes/doc.md');
    expect(await provider.exists('nodes/doc.md')).toBe(false);
  });

  it('list returns vault-relative paths under a prefix', async () => {
    await provider.write('nodes/a.md', Buffer.from('a'));
    await provider.write('nodes/b.md', Buffer.from('b'));
    await provider.write('sources/c.md', Buffer.from('c'));
    const result = await provider.list('nodes/**/*.md');
    expect(result.sort()).toEqual(['nodes/a.md', 'nodes/b.md']);
  });

  it('rename moves a file', async () => {
    await provider.write('nodes/old.md', Buffer.from('x'));
    await provider.rename('nodes/old.md', 'nodes/new.md');
    expect(await provider.exists('nodes/old.md')).toBe(false);
    expect(await provider.exists('nodes/new.md')).toBe(true);
  });

  it('deleteDir removes all files under a prefix', async () => {
    await provider.write('_suggestions/doc/s1.patch', Buffer.from('p'));
    await provider.write('_suggestions/doc/s1.meta.yaml', Buffer.from('m'));
    await provider.deleteDir('_suggestions/doc');
    expect(await provider.list('_suggestions/**/*')).toEqual([]);
  });
});

describe('StorageProvider new capability methods', () => {
  it('stat returns null for a missing path and size/mtimeMs for an existing one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sp-test-'));
    try {
      const provider = new FsStorageProvider(root);
      expect(await provider.stat('missing.txt')).toBeNull();
      await provider.write('present.txt', Buffer.from('hello'));
      const info = await provider.stat('present.txt');
      expect(info?.size).toBe(5);
      expect(typeof info?.mtimeMs).toBe('number');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writeExclusive succeeds once and throws StorageConflictError on the second call', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sp-test-'));
    try {
      const provider = new FsStorageProvider(root);
      await provider.writeExclusive('once.txt', Buffer.from('a'));
      await expect(provider.writeExclusive('once.txt', Buffer.from('b'))).rejects.toBeInstanceOf(
        StorageConflictError,
      );
      expect((await provider.read('once.txt'))?.toString('utf-8')).toBe('a');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('appendOrCreate writes the header on first call and appends on subsequent calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sp-test-'));
    try {
      const provider = new FsStorageProvider(root);
      await provider.appendOrCreate('log.txt', 'HEADER\n', 'first\n');
      await provider.appendOrCreate('log.txt', 'HEADER\n', 'second\n');
      const content = (await provider.read('log.txt'))?.toString('utf-8');
      expect(content).toBe('HEADER\nfirst\nsecond\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
