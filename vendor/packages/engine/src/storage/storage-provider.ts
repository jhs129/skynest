export interface StorageProvider {
  /** Read a vault-relative path. Returns null if the file does not exist. */
  read(path: string): Promise<Buffer | null>;
  /**
   * Write data to a vault-relative path. Creates parent directories as needed.
   * `options.sync`, when true, requests that the write be flushed to durable
   * storage before resolving (fsync on FS backends). Blob/Azure backends
   * ignore it — an object-store PUT is already all-or-nothing durable once it
   * resolves, so there is nothing extra to flush.
   */
  write(path: string, data: Buffer, options?: { sync?: boolean }): Promise<void>;
  /** Delete a file at a vault-relative path. No-op if it does not exist. */
  delete(path: string): Promise<void>;
  /** Recursively delete all files under a vault-relative directory prefix. */
  deleteDir(prefix: string): Promise<void>;
  /** Move a file from one vault-relative path to another. */
  rename(from: string, to: string): Promise<void>;
  /**
   * List vault-relative paths matching a glob pattern.
   * Returns paths relative to the vault root (e.g. "nodes/doc.md").
   */
  list(pattern: string): Promise<string[]>;
  /** Return true if a file exists at the given vault-relative path. */
  exists(path: string): Promise<boolean>;
  /**
   * Return size and last-modified time for a vault-relative path, or null if
   * it does not exist. Backs the checkpoint-chain staleness cache and the
   * layout-detection check.
   */
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
  /**
   * Write data only if no file exists yet at `path`. Throws StorageConflictError
   * if it does. FS backends give this a real O_EXCL guarantee; Blob/Azure
   * backends give a best-effort exists-then-write (racy under true concurrent
   * writers, matching the level of safety these backends already had before
   * this method existed).
   */
  writeExclusive(path: string, data: Buffer): Promise<void>;
  /**
   * Ensure `path` exists containing at least `header`, then append `entry` to
   * it. FS backends implement this with an atomic exclusive-create-or-append
   * dance (see FsStorageProvider). Blob/Azure backends implement it as a
   * non-atomic read-modify-write — no worse than the full-rewrite-per-version
   * approach these backends already used before v2.3.0's durability work.
   */
  appendOrCreate(path: string, header: string, entry: string): Promise<void>;
}
