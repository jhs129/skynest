export interface GitVaultSyncProvider {
  /**
   * Record a file write as a versioned commit attributed to the user whose
   * token is provided. Fire-and-forget: failures are logged but must not
   * throw (the caller's Blob write has already succeeded).
   */
  commitFile(params: {
    path: string;
    content: Buffer;
    message: string;
    userToken: string;
  }): Promise<void>;

  /**
   * Record a file deletion as a versioned commit attributed to the user.
   * Fire-and-forget: same error contract as commitFile.
   */
  deleteFile(params: {
    path: string;
    message: string;
    userToken: string;
  }): Promise<void>;
}
