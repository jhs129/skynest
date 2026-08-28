import {
  readFile, writeFile, mkdir, unlink, rename, rm, access, stat as fsStat, open,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import fg from 'fast-glob';
import type { StorageProvider } from '../storage-provider.js';
import { StorageConflictError } from '../storage-errors.js';

export class FsStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, path);
  }

  async read(path: string): Promise<Buffer | null> {
    try {
      return await readFile(this.abs(path));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }

  async delete(path: string): Promise<void> {
    try {
      await unlink(this.abs(path));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async deleteDir(prefix: string): Promise<void> {
    try {
      await rm(this.abs(prefix), { recursive: true, force: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const absDest = this.abs(to);
    await mkdir(dirname(absDest), { recursive: true });
    const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
    const MAX_ATTEMPTS = 10;
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(this.abs(from), absDest);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? "";
        if (attempt >= MAX_ATTEMPTS - 1 || !RETRYABLE.has(code)) throw err;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 250)));
      }
    }
  }

  async list(pattern: string): Promise<string[]> {
    const results = await fg(pattern, { cwd: this.root, onlyFiles: true });
    return results.sort();
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const s = await fsStat(this.abs(path));
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeExclusive(path: string, data: Buffer): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    let handle;
    try {
      handle = await open(abs, 'wx');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new StorageConflictError(path);
      }
      throw err;
    }
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async appendOrCreate(path: string, header: string, entry: string): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    try {
      const created = await open(abs, 'wx');
      try {
        await created.writeFile(header + entry, 'utf-8');
        await created.sync();
      } finally {
        await created.close();
      }
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const handle = await open(abs, 'a');
    try {
      const { size } = await handle.stat();
      await handle.write(size === 0 ? header + entry : entry);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
