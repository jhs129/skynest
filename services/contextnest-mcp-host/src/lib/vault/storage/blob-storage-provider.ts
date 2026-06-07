import { put, del, list, head, get, BlobNotFoundError } from '@vercel/blob';
import type { StorageProvider } from '@promptowl/contextnest-engine';

export interface BlobStorageConfig {
  /** Top-level namespace prefix, e.g. "vault". Read from CONTEXTNEST_BLOB_PREFIX env var. */
  prefix: string;
  /** Vault identifier for multi-repo support, e.g. "default". Read from CONTEXTNEST_DEFAULT_VAULT_ID env var. */
  vaultId: string;
}

export class BlobStorageProvider implements StorageProvider {
  constructor(private readonly config: BlobStorageConfig) {}

  private key(path: string): string {
    return `${this.config.prefix}/${this.config.vaultId}/${path}`;
  }

  private stripPrefix(pathname: string): string {
    const pfx = `${this.config.prefix}/${this.config.vaultId}/`;
    return pathname.startsWith(pfx) ? pathname.slice(pfx.length) : pathname;
  }

  async read(path: string): Promise<Buffer | null> {
    const result = await get(this.key(path), { access: 'private' });
    if (!result || !result.stream) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async write(path: string, data: Buffer): Promise<void> {
    await put(this.key(path), data, { access: 'private', addRandomSuffix: false, allowOverwrite: true });
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
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }
}
