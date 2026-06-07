// Re-export from the refactored storage module.
// Kept at this path for backward compatibility with existing imports.
export {
  NestStorage,
  UNSTAGED_DRIFT_SENTINEL,
  type ReadDocumentOptions,
  type LayoutMode,
} from './storage/nest-storage.js';
export { type StorageProvider } from './storage/storage-provider.js';
export { createStorageProvider } from './storage/storage-factory.js';
export { FsStorageProvider } from './storage/providers/fs-storage-provider.js';
