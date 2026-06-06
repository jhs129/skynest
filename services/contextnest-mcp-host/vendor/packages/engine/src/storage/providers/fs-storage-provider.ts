import {
  readFile, writeFile, mkdir, unlink, rename, rm, access,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import fg from 'fast-glob';
import type { StorageProvider } from '../storage-provider.js';

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
    await rename(this.abs(from), absDest);
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
}
