import { put, del, list, head } from '@vercel/blob';
import type { StorageProvider } from '@promptowl/contextnest-engine';

export interface BlobStorageConfig {
  /** Vault-level key prefix, e.g. "vault". Read from CONTEXTNEST_BLOB_PREFIX env var. */
  prefix: string;
}

export class BlobStorageProvider implements StorageProvider {
  constructor(private readonly config: BlobStorageConfig) {}

  private key(path: string): string {
    return `${this.config.prefix}/${path}`;
  }

  private stripPrefix(pathname: string): string {
    const pfx = `${this.config.prefix}/`;
    return pathname.startsWith(pfx) ? pathname.slice(pfx.length) : pathname;
  }

  async read(path: string): Promise<Buffer | null> {
    try {
      const meta = await head(this.key(path));
      const res = await fetch(meta.downloadUrl);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    await put(this.key(path), data, { access: 'private', addRandomSuffix: false });
  }

  async delete(path: string): Promise<void> {
    const { blobs } = await list({ prefix: this.key(path) });
    if (blobs.length) await del(blobs.map(b => b.url));
  }

  async deleteDir(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await list({ prefix: this.key(prefix), cursor });
      if (result.blobs.length) await del(result.blobs.map(b => b.url));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
  }

  async rename(from: string, to: string): Promise<void> {
    const data = await this.read(from);
    if (data === null) return;
    await this.write(to, data);
    await this.delete(from);
  }

  async list(pattern: string): Promise<string[]> {
    // Convert glob prefix (e.g. "nodes/**/*.md") to a blob list prefix ("nodes/")
    const prefix = pattern.split('*')[0];
    const results: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await list({ prefix: this.key(prefix), cursor });
      for (const blob of result.blobs) {
        results.push(this.stripPrefix(blob.pathname));
      }
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return results.sort();
  }

  async exists(path: string): Promise<boolean> {
    try {
      await head(this.key(path));
      return true;
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) return false;
      throw err;
    }
  }
}
