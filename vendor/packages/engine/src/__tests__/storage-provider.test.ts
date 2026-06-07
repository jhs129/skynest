import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageProvider } from '../storage/providers/fs-storage-provider.js';

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
