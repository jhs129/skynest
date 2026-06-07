export interface StorageProvider {
  /** Read a vault-relative path. Returns null if the file does not exist. */
  read(path: string): Promise<Buffer | null>;
  /** Write data to a vault-relative path. Creates parent directories as needed. */
  write(path: string, data: Buffer): Promise<void>;
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
}
