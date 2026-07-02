export interface VaultSyncProvider {
  /**
   * Record a file write as a versioned, attributed audit-trail entry.
   * Fire-and-forget: failures are logged but must not throw (the caller's
   * Blob write has already succeeded). `userToken` is only required by
   * providers that authenticate as the acting user (e.g. GitHub); providers
   * that assert attribution via metadata instead (e.g. Azure) ignore it.
   */
  commitFile(params: {
    path: string;
    content: Buffer;
    message: string;
    editedBy: string;
    userToken?: string;
  }): Promise<void>;

  /**
   * Record a file deletion as a versioned, attributed audit-trail entry.
   * Same error contract as commitFile.
   */
  deleteFile(params: {
    path: string;
    message: string;
    editedBy: string;
    userToken?: string;
  }): Promise<void>;
}
