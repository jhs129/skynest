/** Thrown by StorageProvider.writeExclusive when the target path already exists. */
export class StorageConflictError extends Error {
  constructor(public readonly path: string) {
    super(`Storage conflict: "${path}" already exists`);
    this.name = 'StorageConflictError';
  }
}
