import { beforeEach, vi } from 'vitest';

/**
 * Global test setup: after each automatic mock reset (mockReset: true),
 * re-establish the serializeDocument mock so tests that depend on it
 * continue to work correctly.
 *
 * The vi.mock() factory in route.test.ts sets mockReturnValue once,
 * but mockReset: true calls vi.resetAllMocks() which wipes implementations.
 * This global beforeEach re-establishes the mock after the reset runs.
 */
beforeEach(async () => {
  try {
    const engine = await import('@promptowl/contextnest-engine');
    const mocked = vi.mocked(engine.serializeDocument);
    if (mocked && typeof mocked.mockReturnValue === 'function') {
      mocked.mockReturnValue('serialized-content');
    }
  } catch {
    // Not all test files mock this module; ignore errors
  }
});
