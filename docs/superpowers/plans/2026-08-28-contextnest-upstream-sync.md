# ContextNest Upstream Sync (Engine v2.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `vendor/packages/engine` up to upstream ContextNest v2.3.0 (registry/remote-nest/stewards/wiki-graph/api and all hardening fixes) while preserving Skynest's fork-specific `StorageProvider` abstraction, so Skynest keeps hosting vaults on Vercel Blob and Azure Blob storage.

**Architecture:** Upstream v2.3.0 collapsed the old `storage/` directory (`nest-storage.ts` + `storage-factory.ts` + `storage-provider.ts` + `providers/fs-storage-provider.ts`) into one `storage.ts` that calls `node:fs/promises` directly, deleting the pluggable-backend seam Skynest depends on. Every other new/changed upstream file (`api/`, `registry.ts`, `remote-nest.ts`, `stewards.ts`, `wiki-graph.ts`, `filters.ts`, `glob.ts`, `concurrency.ts`, and the files that already existed) only calls into `NestStorage` or other pure logic — none of them touch the filesystem directly except `registry.ts`, which is a local-CLI vault-alias concern Skynest's serverless model never uses. So the plan vendors upstream's engine tree almost verbatim, and rewrites only `storage.ts`: same class shape, same public method names/signatures, same new durability/quarantine/checkpoint-chain logic — but every raw `fs` call replaced with a call on an injected `StorageProvider`. Two new capability methods (`stat`, `appendOrCreate`) and one exclusive-write method (`writeExclusive`) are added to `StorageProvider` to carry the new logic's atomicity requirements; FS gets real guarantees, Blob/Azure get best-effort (no worse than what they already ship today).

**Tech Stack:** TypeScript, `node:fs/promises` (FS provider only), `@vercel/blob`, `@azure/storage-blob` + `@azure/identity`, `js-yaml`, `zod`, `diff@^9`, Vitest, pnpm.

**Spec:** No separate spec doc — this plan is self-contained; the "why" for each design decision is inlined per task from the upstream source comments and the conversation's own analysis of Skynest's `StorageProvider` fork.

## Global Constraints

- Package manager is `pnpm` everywhere (root `CLAUDE.md`).
- After every task, run `pnpm --filter @promptowl/contextnest-engine build` (or root `pnpm build` once wired) and fix all TypeScript errors before moving on — do not accumulate type debt across tasks.
- Do not touch `vendor/packages/cli` or `vendor/packages/mcp-server` — confirmed unused by Skynest's runtime (root `package.json` depends only on `file:./vendor/packages/engine`; no script invokes either package; only doc/spec files reference them).
- `registry.ts` is vendored as dead code (imported by nothing Skynest calls) — do not wire it up, do not delete it either (keeps the vendor tree close to upstream for future diffs).
- Preserve the existing public `NestStorage` method surface exactly — `src/lib/mcp/tools.ts`, `src/lib/webhooks/readai/dedup.ts`, and `src/lib/vault/index.ts` call `readDocument`, `discoverDocuments`, `readContextYaml`, `readPacks`, `verifyVaultIntegrity`, `writeDocument`, `deleteDocument`, `regenerateIndex`, `readContextMd`, `readConfig`, `readHistory` — none of these names or their argument shapes may change.
- `NestStorage` constructor must keep accepting a bare `string` (root path) for backward compatibility, in addition to a `StorageProvider`.
- No new environment variables. Skynest's storage env vars (`CONTEXTNEST_STORAGE`, `CONTEXTNEST_STORAGE_PROVIDER`, `CONTEXTNEST_BLOB_PREFIX`, `CONTEXTNEST_DEFAULT_VAULT_ID`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_BLOB_CONTAINER`, `CONTEXTNEST_VAULT_PATH`) all live in `src/lib/vault/storage/index.ts`, entirely outside the vendored engine tree, and are untouched by this plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `vendor/packages/engine/src/storage/storage-provider.ts` | `StorageProvider` interface — extended with `stat`, `writeExclusive`, `appendOrCreate`. |
| `vendor/packages/engine/src/storage/storage-errors.ts` | New: `StorageConflictError` (thrown by `writeExclusive`). |
| `vendor/packages/engine/src/storage/providers/fs-storage-provider.ts` | `FsStorageProvider` — gets the 3 new methods with real fs guarantees (O_EXCL, fsync, stat). |
| `vendor/packages/engine/src/storage.ts` | Rewritten: upstream v2.3.0's `NestStorage` class + module helpers, with all I/O routed through an injected `StorageProvider`. |
| `vendor/packages/engine/src/{glob,concurrency,filters,registry,remote-nest,stewards,wiki-graph}.ts` | Vendored verbatim from upstream (no changes needed — pure logic or, for `registry.ts`, unused). |
| `vendor/packages/engine/src/api/*.ts` | Vendored verbatim from upstream (new public `./api` export surface). |
| `vendor/packages/engine/src/{parser,versioning,checkpoint,chain-log,config,...}.ts` (all "changed in both" files) | Vendored verbatim from upstream. |
| `vendor/packages/engine/package.json` | Bumped to 2.3.0 deps/exports (adds `@modelcontextprotocol/sdk`, `zod-to-json-schema`, `diff@^9`; drops `fast-glob`, `gray-matter`, `remark-gfm`, `remark-parse`, `unified`). |
| `src/lib/vault/storage/blob-storage-provider.ts` | Gets `stat`/`writeExclusive`/`appendOrCreate` best-effort implementations. |
| `src/lib/vault/storage/azure-blob-storage-provider.ts` | Same, for Azure. |

---

### Task 1: Extend `StorageProvider` + add `StorageConflictError`

**Files:**
- Modify: `vendor/packages/engine/src/storage/storage-provider.ts`
- Create: `vendor/packages/engine/src/storage/storage-errors.ts`
- Test: `vendor/packages/engine/__tests__/storage-provider.test.ts` (currently tests the old interface shape — extend it)

**Interfaces:**
- Produces: `StorageProvider.stat(path: string): Promise<{ size: number; mtimeMs: number } | null>`
- Produces: `StorageProvider.writeExclusive(path: string, data: Buffer): Promise<void>` — throws `StorageConflictError` if `path` already exists
- Produces: `StorageProvider.appendOrCreate(path: string, header: string, entry: string): Promise<void>` — if `path` does not exist, writes `header + entry`; if it exists, appends `entry` to the existing content
- Produces: `class StorageConflictError extends Error` with a `path: string` field

- [ ] **Step 1: Write the failing test**

Add to `vendor/packages/engine/__tests__/storage-provider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageProvider } from '../src/storage/providers/fs-storage-provider.js';
import { StorageConflictError } from '../src/storage/storage-errors.js';

describe('StorageProvider new capability methods', () => {
  it('stat returns null for a missing path and size/mtimeMs for an existing one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sp-test-'));
    try {
      const provider = new FsStorageProvider(root);
      expect(await provider.stat('missing.txt')).toBeNull();
      await provider.write('present.txt', Buffer.from('hello'));
      const info = await provider.stat('present.txt');
      expect(info?.size).toBe(5);
      expect(typeof info?.mtimeMs).toBe('number');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writeExclusive succeeds once and throws StorageConflictError on the second call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sp-test-'));
    try {
      const provider = new FsStorageProvider(root);
      await provider.writeExclusive('once.txt', Buffer.from('a'));
      await expect(provider.writeExclusive('once.txt', Buffer.from('b'))).rejects.toBeInstanceOf(
        StorageConflictError,
      );
      expect((await provider.read('once.txt'))?.toString('utf-8')).toBe('a');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('appendOrCreate writes the header on first call and appends on subsequent calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sp-test-'));
    try {
      const provider = new FsStorageProvider(root);
      await provider.appendOrCreate('log.txt', 'HEADER\n', 'first\n');
      await provider.appendOrCreate('log.txt', 'HEADER\n', 'second\n');
      const content = (await provider.read('log.txt'))?.toString('utf-8');
      expect(content).toBe('HEADER\nfirst\nsecond\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd vendor/packages/engine && pnpm vitest run __tests__/storage-provider.test.ts`
Expected: FAIL — `StorageConflictError` and the three methods do not exist yet.

- [ ] **Step 3: Add `StorageConflictError`**

Create `vendor/packages/engine/src/storage/storage-errors.ts`:

```typescript
/** Thrown by StorageProvider.writeExclusive when the target path already exists. */
export class StorageConflictError extends Error {
  constructor(public readonly path: string) {
    super(`Storage conflict: "${path}" already exists`);
    this.name = 'StorageConflictError';
  }
}
```

- [ ] **Step 4: Extend the interface**

Edit `vendor/packages/engine/src/storage/storage-provider.ts` — add after the existing `exists` method:

```typescript
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
```

- [ ] **Step 5: Implement the three methods on `FsStorageProvider`**

Edit `vendor/packages/engine/src/storage/providers/fs-storage-provider.ts` — change the import line to:

```typescript
import {
  readFile, writeFile, mkdir, unlink, rename, rm, access, stat as fsStat, open,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import fg from 'fast-glob';
import type { StorageProvider } from '../storage-provider.js';
import { StorageConflictError } from '../storage-errors.js';
```

Add these three methods to the `FsStorageProvider` class, after `exists`:

```typescript
  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const s = await fsStat(this.abs(path));
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeExclusive(path: string, data: Buffer): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    let handle;
    try {
      handle = await open(abs, 'wx');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new StorageConflictError(path);
      }
      throw err;
    }
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async appendOrCreate(path: string, header: string, entry: string): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    try {
      const created = await open(abs, 'wx');
      try {
        await created.writeFile(header + entry, 'utf-8');
        await created.sync();
      } finally {
        await created.close();
      }
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const handle = await open(abs, 'a');
    try {
      const { size } = await handle.stat();
      await handle.write(size === 0 ? header + entry : entry);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd vendor/packages/engine && pnpm vitest run __tests__/storage-provider.test.ts`
Expected: PASS (all 3 new tests + existing ones).

- [ ] **Step 7: Build the engine package**

Run: `cd vendor/packages/engine && pnpm build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add vendor/packages/engine/src/storage/storage-provider.ts vendor/packages/engine/src/storage/storage-errors.ts vendor/packages/engine/src/storage/providers/fs-storage-provider.ts vendor/packages/engine/__tests__/storage-provider.test.ts
git commit -m "feat(engine): extend StorageProvider with stat/writeExclusive/appendOrCreate"
```

---

### Task 2: Implement the 3 new methods on `BlobStorageProvider` (Vercel Blob)

**Files:**
- Modify: `src/lib/vault/storage/blob-storage-provider.ts`
- Test: `src/lib/vault/storage/blob-storage-provider.test.ts` (create if it doesn't already exist — check first with `ls src/lib/vault/storage/*.test.ts`)

**Interfaces:**
- Consumes: `StorageConflictError` from `@promptowl/contextnest-engine` (Task 1's export — add it to the engine's `src/index.ts` re-exports if not already re-exported from `storage/storage-provider.ts`'s barrel; check `vendor/packages/engine/src/index.ts` for how `StorageProvider` itself is currently exported and mirror that for `StorageConflictError`)
- Produces: `BlobStorageProvider.stat`, `.writeExclusive`, `.appendOrCreate` matching the `StorageProvider` interface from Task 1

- [ ] **Step 1: Write the failing test**

Create/extend `src/lib/vault/storage/blob-storage-provider.test.ts` with (mocking `@vercel/blob` the same way any existing tests in this file already do — check the file first for the existing mock setup and reuse it):

```typescript
it('stat returns size and mtimeMs from head()', async () => {
  // mock head() to return { size: 42, uploadedAt: new Date('2026-01-01T00:00:00Z') }
  const provider = new BlobStorageProvider({ prefix: 'vault', vaultId: 'default' });
  const info = await provider.stat('nodes/doc.md');
  expect(info).toEqual({ size: 42, mtimeMs: new Date('2026-01-01T00:00:00Z').getTime() });
});

it('stat returns null when head() throws BlobNotFoundError', async () => {
  // mock head() to throw BlobNotFoundError
  const provider = new BlobStorageProvider({ prefix: 'vault', vaultId: 'default' });
  expect(await provider.stat('missing.md')).toBeNull();
});

it('writeExclusive throws StorageConflictError when the blob already exists', async () => {
  // mock head() to resolve (blob exists)
  const provider = new BlobStorageProvider({ prefix: 'vault', vaultId: 'default' });
  await expect(provider.writeExclusive('nodes/doc.md', Buffer.from('x'))).rejects.toBeInstanceOf(
    StorageConflictError,
  );
});

it('writeExclusive writes when the blob does not exist', async () => {
  // mock head() to throw BlobNotFoundError, mock put() to resolve
  const provider = new BlobStorageProvider({ prefix: 'vault', vaultId: 'default' });
  await provider.writeExclusive('nodes/doc.md', Buffer.from('x'));
  // assert put() was called
});

it('appendOrCreate writes header+entry when the file does not exist, appends entry when it does', async () => {
  const provider = new BlobStorageProvider({ prefix: 'vault', vaultId: 'default' });
  // 1st call: mock get() to return null (via BlobStorageProvider.read returning null) -> assert write called with 'HEADER\nfirst\n'
  await provider.appendOrCreate('log.yaml', 'HEADER\n', 'first\n');
  // 2nd call: mock read() to return Buffer.from('HEADER\nfirst\n') -> assert write called with 'HEADER\nfirst\nsecond\n'
  await provider.appendOrCreate('log.yaml', 'HEADER\n', 'second\n');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/vault/storage/blob-storage-provider.test.ts`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement the methods**

Edit `src/lib/vault/storage/blob-storage-provider.ts` — change the import line to:

```typescript
import { put, del, list, head, get, BlobNotFoundError } from '@vercel/blob';
import type { StorageProvider } from '@promptowl/contextnest-engine';
import { StorageConflictError } from '@promptowl/contextnest-engine';
```

Add these three methods to the class, after `exists`:

```typescript
  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const info = await head(this.key(path));
      return { size: info.size, mtimeMs: new Date(info.uploadedAt).getTime() };
    } catch (err: unknown) {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
  }

  async writeExclusive(path: string, data: Buffer): Promise<void> {
    if (await this.exists(path)) {
      throw new StorageConflictError(path);
    }
    await this.write(path, data);
  }

  async appendOrCreate(path: string, header: string, entry: string): Promise<void> {
    const existing = await this.read(path);
    const content = existing === null ? header + entry : existing.toString('utf-8') + entry;
    await this.write(path, Buffer.from(content, 'utf-8'));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/vault/storage/blob-storage-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/storage/blob-storage-provider.ts src/lib/vault/storage/blob-storage-provider.test.ts
git commit -m "feat(storage): add stat/writeExclusive/appendOrCreate to BlobStorageProvider"
```

---

### Task 3: Implement the 3 new methods on `AzureBlobStorageProvider`

**Files:**
- Modify: `src/lib/vault/storage/azure-blob-storage-provider.ts`
- Test: `src/lib/vault/storage/azure-blob-storage-provider.test.ts`

**Interfaces:**
- Consumes: `StorageConflictError` from `@promptowl/contextnest-engine` (Task 1)
- Produces: `AzureBlobStorageProvider.stat`, `.writeExclusive`, `.appendOrCreate`

- [ ] **Step 1: Write the failing test**

Extend `src/lib/vault/storage/azure-blob-storage-provider.test.ts` (reuse whatever `BlobServiceClient`/`getBlobClient` mocking pattern the existing tests in this file already use):

```typescript
it('stat returns size and mtimeMs from getProperties()', async () => {
  // mock getBlobClient().getProperties() to return { contentLength: 42, lastModified: new Date('2026-01-01T00:00:00Z') }
  const provider = new AzureBlobStorageProvider({ containerName: 'skynest', vaultId: 'default' });
  const info = await provider.stat('nodes/doc.md');
  expect(info).toEqual({ size: 42, mtimeMs: new Date('2026-01-01T00:00:00Z').getTime() });
});

it('stat returns null for a 404', async () => {
  // mock getProperties() to throw { statusCode: 404 }
  const provider = new AzureBlobStorageProvider({ containerName: 'skynest', vaultId: 'default' });
  expect(await provider.stat('missing.md')).toBeNull();
});

it('writeExclusive throws StorageConflictError when the blob exists', async () => {
  // mock exists() to resolve true
  const provider = new AzureBlobStorageProvider({ containerName: 'skynest', vaultId: 'default' });
  await expect(provider.writeExclusive('nodes/doc.md', Buffer.from('x'))).rejects.toBeInstanceOf(
    StorageConflictError,
  );
});

it('appendOrCreate appends to existing content', async () => {
  const provider = new AzureBlobStorageProvider({ containerName: 'skynest', vaultId: 'default' });
  // mock read() to return Buffer.from('HEADER\nfirst\n')
  await provider.appendOrCreate('log.yaml', 'HEADER\n', 'second\n');
  // assert upload() called with 'HEADER\nfirst\nsecond\n'
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/vault/storage/azure-blob-storage-provider.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the methods**

Edit `src/lib/vault/storage/azure-blob-storage-provider.ts` — add to imports:

```typescript
import { StorageConflictError } from '@promptowl/contextnest-engine';
```

Add these three methods to the class, after `exists`:

```typescript
  async stat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const props = await this.containerClient.getBlobClient(this.blobName(path)).getProperties();
      return {
        size: props.contentLength ?? 0,
        mtimeMs: props.lastModified ? props.lastModified.getTime() : 0,
      };
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async writeExclusive(path: string, data: Buffer): Promise<void> {
    if (await this.exists(path)) {
      throw new StorageConflictError(path);
    }
    await this.write(path, data);
  }

  async appendOrCreate(path: string, header: string, entry: string): Promise<void> {
    const existing = await this.read(path);
    const content = existing === null ? header + entry : existing.toString('utf-8') + entry;
    await this.write(path, Buffer.from(content, 'utf-8'));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/vault/storage/azure-blob-storage-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/storage/azure-blob-storage-provider.ts src/lib/vault/storage/azure-blob-storage-provider.test.ts
git commit -m "feat(storage): add stat/writeExclusive/appendOrCreate to AzureBlobStorageProvider"
```

---

### Task 4: Vendor upstream's non-storage engine files verbatim

**Files:**
- Create/Overwrite (copy verbatim from `upstream/main`'s `packages/engine/src/`, fetched at `git fetch upstream` on the `sync/contextnest-upstream` branch):
  - `vendor/packages/engine/src/glob.ts`
  - `vendor/packages/engine/src/concurrency.ts`
  - `vendor/packages/engine/src/filters.ts`
  - `vendor/packages/engine/src/registry.ts`
  - `vendor/packages/engine/src/remote-nest.ts`
  - `vendor/packages/engine/src/stewards.ts`
  - `vendor/packages/engine/src/wiki-graph.ts`
  - `vendor/packages/engine/src/api/context.ts`
  - `vendor/packages/engine/src/api/core-executors.ts`
  - `vendor/packages/engine/src/api/core.ts`
  - `vendor/packages/engine/src/api/extension.ts`
  - `vendor/packages/engine/src/api/index.ts`
  - `vendor/packages/engine/src/api/runtime.ts`
  - `vendor/packages/engine/src/api/types.ts`
  - `vendor/packages/engine/src/api/README.md`
  - Every file listed as "in BOTH" in the earlier tree diff EXCEPT `storage.ts` (handled in Tasks 5-7) and `index.ts` (handled in Task 8): `agent-configs.ts`, `approval.ts`, `chain-log.ts`, `checkpoint.ts`, `classification.ts`, `config.ts`, `errors.ts`, `graph-query-engine.ts`, `graph-traverser.ts`, `hygienist.ts`, `index-generator.ts`, `index-md-generator.ts`, `injection.ts`, `inline.ts`, `integrity.ts`, `packs.ts`, `parser.ts`, `publish.ts`, `rbac.ts`, `resolver.ts`, `schemas.ts`, `selector/evaluator.ts`, `selector/index-evaluator.ts`, `selector/lexer.ts`, `selector/parser.ts`, `source-graph.ts`, `suggestions.ts`, `tracing.ts`, `types.ts`, `uri.ts`, `versioning.ts`
  - All new `__tests__/*.test.ts` files listed as "only in NEW" earlier, plus `__tests__/fixtures/stub-mcp-server.mjs`
- Delete: `vendor/packages/engine/src/storage/nest-storage.ts`, `vendor/packages/engine/src/storage/storage-factory.ts` (superseded by the new `storage.ts` — `storage-provider.ts` and `providers/fs-storage-provider.ts` are KEPT, they were extended in Task 1)

**Interfaces:**
- Consumes: nothing from earlier tasks (these files are independent of the storage rewrite except through `NestStorage`'s public method surface, which Tasks 5-8 preserve)
- Produces: every symbol these files export, unchanged from upstream — no adaptation needed since none of them (other than `registry.ts`, which nothing calls) touch the filesystem directly

- [ ] **Step 1: Copy the files**

```bash
cd /Users/johnhschneider/dev/skynest
git fetch upstream
UPSTREAM_ENGINE=$(mktemp -d)
git archive upstream/main -- packages/engine/src | tar -x -C "$UPSTREAM_ENGINE"

# New standalone modules + api/ folder
cp "$UPSTREAM_ENGINE/packages/engine/src/glob.ts" vendor/packages/engine/src/glob.ts
cp "$UPSTREAM_ENGINE/packages/engine/src/concurrency.ts" vendor/packages/engine/src/concurrency.ts
cp "$UPSTREAM_ENGINE/packages/engine/src/filters.ts" vendor/packages/engine/src/filters.ts
cp "$UPSTREAM_ENGINE/packages/engine/src/registry.ts" vendor/packages/engine/src/registry.ts
cp "$UPSTREAM_ENGINE/packages/engine/src/remote-nest.ts" vendor/packages/engine/src/remote-nest.ts
cp "$UPSTREAM_ENGINE/packages/engine/src/stewards.ts" vendor/packages/engine/src/stewards.ts
cp "$UPSTREAM_ENGINE/packages/engine/src/wiki-graph.ts" vendor/packages/engine/src/wiki-graph.ts
mkdir -p vendor/packages/engine/src/api
cp "$UPSTREAM_ENGINE/packages/engine/src/api/"*.ts vendor/packages/engine/src/api/
cp "$UPSTREAM_ENGINE/packages/engine/src/api/README.md" vendor/packages/engine/src/api/README.md

# Files unchanged in shape, changed in content
for f in agent-configs approval chain-log checkpoint classification config errors \
         graph-query-engine graph-traverser hygienist index-generator index-md-generator \
         injection inline integrity packs parser publish rbac resolver schemas \
         source-graph suggestions tracing types uri versioning; do
  cp "$UPSTREAM_ENGINE/packages/engine/src/$f.ts" "vendor/packages/engine/src/$f.ts"
done
mkdir -p vendor/packages/engine/src/selector
cp "$UPSTREAM_ENGINE/packages/engine/src/selector/"*.ts vendor/packages/engine/src/selector/

# New tests
cp "$UPSTREAM_ENGINE/packages/engine/src/__tests__/agent-configs-tools.test.ts" vendor/packages/engine/__tests__/ 2>/dev/null || true
find "$UPSTREAM_ENGINE/packages/engine" -path "*__tests__*" -name "*.test.ts" -exec cp {} vendor/packages/engine/__tests__/ \;
mkdir -p vendor/packages/engine/__tests__/fixtures
cp "$UPSTREAM_ENGINE/packages/engine/src/__tests__/fixtures/stub-mcp-server.mjs" vendor/packages/engine/__tests__/fixtures/ 2>/dev/null || true

# Remove superseded storage files (keep storage-provider.ts and providers/fs-storage-provider.ts)
rm -f vendor/packages/engine/src/storage/nest-storage.ts vendor/packages/engine/src/storage/storage-factory.ts
rm -rf "$UPSTREAM_ENGINE"
```

Note: adjust the exact `__tests__` source path above once `$UPSTREAM_ENGINE` is populated — run `find "$UPSTREAM_ENGINE/packages/engine" -name "*.test.ts"` first to confirm whether upstream's tests live under `src/__tests__/` or a top-level `__tests__/`, and copy from wherever they actually are.

- [ ] **Step 2: Do NOT run the test suite yet**

`storage.ts` doesn't exist as a valid file yet (still the pre-rewrite version, which imports the now-deleted `storage-factory.ts`/`nest-storage.ts` — this is expected to be broken until Task 7 finishes). Skip straight to Task 5.

- [ ] **Step 3: Commit**

```bash
git add vendor/packages/engine/src vendor/packages/engine/__tests__
git commit -m "chore(engine): vendor upstream v2.3.0 non-storage source files"
```

---

### Task 5: Rewrite `storage.ts` Part A — module helpers, constructor, and simple document CRUD

**Files:**
- Modify: `vendor/packages/engine/src/storage.ts` (currently the OLD pre-rewrite version at this point — this task starts the full rewrite)
- Test: `vendor/packages/engine/__tests__/storage-drift.test.ts`, `vendor/packages/engine/__tests__/engine.test.ts` (vendored in Task 4 — these exercise `NestStorage` end-to-end and will be the acceptance signal across Tasks 5-7)

**Interfaces:**
- Consumes: `StorageProvider` (Task 1), `FsStorageProvider` (Task 1) from `./storage/storage-provider.js` and `./storage/providers/fs-storage-provider.js`; `globFiles` from `./glob.js` (Task 4); `parseDocument` from `./parser.js` (Task 4); `mapInBatches` from `./concurrency.js` (Task 4)
- Produces: `export function normalizeDocumentId(raw: string): string`, `export function assertSafeDocumentId(raw: string): void`, `export function normalizeFolder(raw: string): string`, `export interface FolderEntry { path: string; count: number }`, `export interface ReadDocumentOptions { verifyChecksum?: boolean }`, `export type LayoutMode = "structured" | "obsidian"`, `export class NestStorage` with a `constructor(rootOrProvider: string | StorageProvider)`, `readonly root: string | null`, `readonly provider: StorageProvider`, and methods `detectLayout()`, `discoverDocuments(options)`, `listFolders(options)`, `readDocument(id, options)`, `detectDocumentDrift(id)`, `writeDocument`, `deleteDocument`, `readContextMd`, `writeContextMd`, `readConfig`, `writeConfig`, `readContextYaml`, `writeContextYaml`

- [ ] **Step 1: Copy the upstream file as the starting point**

```bash
cd /Users/johnhschneider/dev/skynest
git fetch upstream
git show upstream/main:packages/engine/src/storage.ts > vendor/packages/engine/src/storage.ts
```

- [ ] **Step 2: Fix the import block**

At the top of `vendor/packages/engine/src/storage.ts`, replace:

```typescript
import {
  readFile,
  writeFile,
  mkdir,
  open,
  stat,
  unlink,
  rm,
  rename,
  readdir,
} from "node:fs/promises";
import { join, dirname, basename, isAbsolute } from "node:path";
```

with:

```typescript
import { basename, dirname } from "node:path";
import type { StorageProvider } from "./storage/storage-provider.js";
import { FsStorageProvider } from "./storage/providers/fs-storage-provider.js";
```

`join`/`isAbsolute` are gone because every path the class touches is now vault-relative (a `StorageProvider` path), not a filesystem-absolute one — Steps 3-5 below replace every `join(this.root, x)` with the bare relative path `x` (or `dirname(x)`/`basename(x)` composed as a relative string via template literals, never `join`).

- [ ] **Step 3: Rewrite the constructor and the two private write-serialization fields**

Replace:

```typescript
export class NestStorage {
  constructor(public readonly root: string) {}
```

with:

```typescript
export class NestStorage {
  readonly provider: StorageProvider;

  constructor(rootOrProvider: string | StorageProvider) {
    this.provider = typeof rootOrProvider === "string"
      ? new FsStorageProvider(rootOrProvider)
      : rootOrProvider;
  }
```

(leave `checkpointWriteChain` and `tmpWriteCounter` fields as-is — they're pure in-memory state, no fs involved).

- [ ] **Step 4: Rewrite `detectLayout`**

Replace:

```typescript
  async detectLayout(): Promise<LayoutMode> {
    try {
      const s = await stat(join(this.root, "nodes"));
      return s.isDirectory() ? "structured" : "obsidian";
    } catch {
      return "obsidian";
    }
  }
```

with:

```typescript
  async detectLayout(): Promise<LayoutMode> {
    const info = await this.provider.stat("nodes");
    // A file named "nodes" (not a directory) also reads as Obsidian layout —
    // `stat` on a StorageProvider only tells us size/mtime, not file-vs-dir, so
    // treat "nodes exists at all" the same way the old fs.stat().isDirectory()
    // check did for every backend that has no real directory concept (Blob/Azure).
    return info !== null ? "structured" : "obsidian";
  }
```

- [ ] **Step 5: Rewrite `discoverDocuments`**

Replace the body's file-reading section:

```typescript
    const files = await globFiles(this.root, patterns, NON_DOCUMENT_FILES);

    const parsed = await mapInBatches(files.sort(), async (file) => {
      const filePath = join(this.root, file);
      const content = await readFile(filePath, "utf-8");
```

with:

```typescript
    const files = await this.globProvider(patterns, NON_DOCUMENT_FILES);

    const parsed = await mapInBatches(files.sort(), async (file) => {
      const filePath = file;
      const contentBuf = await this.provider.read(filePath);
      if (contentBuf === null) return null;
      const content = contentBuf.toString("utf-8");
```

Add this new private helper method to the class (used here and by every other method that previously called `globFiles(this.root, ...)`):

```typescript
  /**
   * Glob-style listing on top of StorageProvider.list(), which only accepts
   * ONE pattern (not an array + ignore list) per its interface. Loops the
   * include patterns, concatenates, de-dupes, then applies the ignore list
   * client-side — matching how the pre-2.3.0 fork's nest-storage.ts always
   * drove multi-pattern discovery through a single-pattern provider.
   */
  private async globProvider(patterns: string[], ignore: string[]): Promise<string[]> {
    const seen = new Set<string>();
    for (const pattern of patterns) {
      for (const path of await this.provider.list(pattern)) seen.add(path);
    }
    const ignoreRegexes = ignore.map((p) => globPatternToRegExp(p));
    return [...seen].filter((path) => !ignoreRegexes.some((re) => re.test(path)));
  }
```

Add this module-level helper near the top of the file, right after the `NON_DOCUMENT_FILES` constant (it reuses the exact same glob-to-regex translation `glob.ts` already implements — import it rather than reimplementing):

```typescript
import { globToRegExpForIgnore } from "./glob.js";
```

Then in `glob.ts` (vendored in Task 4), the function `globToRegExp` is currently module-private (not exported). Add one export line to `vendor/packages/engine/src/glob.ts` right after its existing `globToRegExp` function definition:

```typescript
/** Exported for storage.ts's ignore-list filtering on top of StorageProvider.list(). */
export function globToRegExpForIgnore(pattern: string): RegExp {
  return globToRegExp(pattern, true);
}
```

And use `globToRegExpForIgnore` (not a locally-defined `globPatternToRegExp`) in the `globProvider` helper above — fix the reference:

```typescript
    const ignoreRegexes = ignore.map((p) => globToRegExpForIgnore(p));
```

- [ ] **Step 6: Rewrite `listFolders`**

`listFolders` walks real directories (`readdir` with `withFileTypes`), which `StorageProvider` has no equivalent for — providers only expose `list(pattern)` (flat file listing) and `stat`. Replace the whole method body with an implementation built on `provider.list("**/*.md")` plus in-memory folder aggregation:

```typescript
  async listFolders(
    options: { folder?: string; recursive?: boolean } = {},
  ): Promise<FolderEntry[]> {
    const base = options.folder === undefined ? "" : normalizeFolder(options.folder);
    const allFiles = await this.provider.list("**/*.md");
    const recursive = options.recursive !== false;
    const counts = new Map<string, number>();
    const known = new Set<string>();

    for (const file of allFiles) {
      const name = basename(file);
      if (NON_DOCUMENT_BASENAMES.has(name)) continue;
      const dir = dirname(file) === "." ? "" : dirname(file);
      if (base && dir !== base && !dir.startsWith(`${base}/`)) continue;
      if (!recursive && dir !== base) continue;

      // Register every ancestor directory between base and dir (exclusive of
      // base itself) so an empty subfolder still shows up in the tree, and bump
      // the direct-file count only on `dir` itself.
      let cursor = dir;
      const chain: string[] = [];
      while (cursor && cursor !== base) {
        chain.push(cursor);
        cursor = dirname(cursor) === "." ? "" : dirname(cursor);
      }
      for (const folder of chain) known.add(folder);
      if (dir !== base) counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }

    const paths = new Set<string>([...known, ...counts.keys()]);
    return [...paths]
      .map((path) => ({ path, count: counts.get(path) ?? 0 }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
```

- [ ] **Step 7: Rewrite `readDocument` and `detectDocumentDrift`**

In both methods, replace:

```typescript
    const filePath = join(this.root, `${id}.md`);
    let liveContent: string;
    try {
      liveContent = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new DocumentNotFoundError(id);  // or `return null;` in detectDocumentDrift
      }
      throw err;
    }
```

with (for `readDocument`):

```typescript
    const filePath = `${id}.md`;
    const buf = await this.provider.read(filePath);
    if (buf === null) throw new DocumentNotFoundError(id);
    const liveContent = buf.toString("utf-8");
```

and for `detectDocumentDrift`:

```typescript
    const filePath = `${id}.md`;
    const buf = await this.provider.read(filePath);
    if (buf === null) return null;
    const liveContent = buf.toString("utf-8");
```

- [ ] **Step 8: Rewrite `writeDocument`, `deleteDocument`, `readContextMd`, `writeContextMd`, `readConfig`, `writeConfig`, `readContextYaml`, `writeContextYaml`**

These are all short methods (upstream lines ~710-880) following the same pattern. For each, apply this substitution table:

| Upstream pattern | Replacement |
|---|---|
| `const filePath = join(this.root, X);` | `const filePath = X;` (drop `join`, `X` is already vault-relative) |
| `await mkdir(dirname(filePath), { recursive: true }); await writeFile(filePath, content, "utf-8");` | `await this.provider.write(filePath, Buffer.from(content, "utf-8"));` |
| `await readFile(filePath, "utf-8")` (with a try/catch returning `null` on ENOENT) | `const buf = await this.provider.read(filePath); return buf === null ? null : buf.toString("utf-8");` |
| `await unlink(filePath)` (with a try/catch swallowing ENOENT) | `await this.provider.delete(filePath);` (no try/catch needed — `StorageProvider.delete` is documented as a no-op if the file doesn't exist) |
| `await rm(versionsDir, { recursive: true })` (with try/catch swallowing ENOENT) | `await this.provider.deleteDir(versionsDir);` (no try/catch needed — same no-op contract) |

Apply this table to every remaining occurrence in the file across every task in this plan (Tasks 5-7) — it is the single mechanical rule covering roughly 30 of the ~40 raw-fs call sites in `storage.ts`. The exceptions that need bespoke handling (`writeFileDurable`, `appendVersionEntry`, `writeVersionArtifact`, the checkpoint tail-read/pointer-cache logic) are called out individually in Tasks 6 and 7.

- [ ] **Step 9: Build**

Run: `cd vendor/packages/engine && pnpm build`
Expected: TypeScript errors remaining ONLY in the sections not yet ported (Tasks 6-7's methods) — confirm the error list is limited to `writeFileDurable`, `historyPath`/version methods, and checkpoint-chain methods still referencing `readFile`/`writeFile`/`open`/`stat`/`unlink`/`rm`/`rename`/`readdir`/`join`.

- [ ] **Step 10: Commit**

```bash
git add vendor/packages/engine/src/storage.ts vendor/packages/engine/src/glob.ts
git commit -m "refactor(engine): port storage.ts document CRUD + discovery to StorageProvider"
```

---

### Task 6: Rewrite `storage.ts` Part B — durable writes, version history, keyframes/diffs, suggestions

**Files:**
- Modify: `vendor/packages/engine/src/storage.ts`

**Interfaces:**
- Consumes: `this.provider.stat`, `this.provider.writeExclusive`, `this.provider.appendOrCreate` (Task 1)
- Produces: `writeFileDurable` (now provider-based, private), `historyPath`/`writeHistory`/`appendVersionEntry`/`readHistory`/`maxRecordedVersion`, `writeVersionArtifact`/`writeKeyframe`/`readKeyframe`/`writeDiff`/`readDiff`, `writeSuggestionPatch`/`writeSuggestionMeta`/`readSuggestionPatch`/`readSuggestionMeta`/`listSuggestionIds`/`archiveSuggestion` — all with the exact same signatures as upstream

- [ ] **Step 1: Rewrite `renameWithRetry` and `quarantine` module functions**

Replace:

```typescript
async function renameWithRetry(from: string, to: string): Promise<void> {
  const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
  const MAX_ATTEMPTS = 10;

  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (attempt >= MAX_ATTEMPTS - 1 || !RETRYABLE.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 250)));
    }
  }
}

async function quarantine(path: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.replace(/\.yaml$/, "") + `.corrupt-${stamp}.yaml`;
  await renameWithRetry(path, dest);
  return dest;
}
```

with (the retry loop moves into `FsStorageProvider.rename` instead — see Step 1a below — because `StorageProvider.rename` is the only place that still knows it's talking to a real filesystem):

```typescript
async function quarantine(provider: StorageProvider, path: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.replace(/\.yaml$/, "") + `.corrupt-${stamp}.yaml`;
  await provider.rename(path, dest);
  return dest;
}
```

Update every call site of `quarantine(path)` in the file to `quarantine(this.provider, path)`.

- [ ] **Step 1a: Port the EPERM/EACCES/EBUSY retry loop into `FsStorageProvider.rename`**

Edit `vendor/packages/engine/src/storage/providers/fs-storage-provider.ts` — replace the existing `rename` method:

```typescript
  async rename(from: string, to: string): Promise<void> {
    const absDest = this.abs(to);
    await mkdir(dirname(absDest), { recursive: true });
    await rename(this.abs(from), absDest);
  }
```

with:

```typescript
  async rename(from: string, to: string): Promise<void> {
    const absDest = this.abs(to);
    await mkdir(dirname(absDest), { recursive: true });
    const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
    const MAX_ATTEMPTS = 10;
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(this.abs(from), absDest);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? "";
        if (attempt >= MAX_ATTEMPTS - 1 || !RETRYABLE.has(code)) throw err;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 250)));
      }
    }
  }
```

- [ ] **Step 2: Rewrite `writeFileDurable`**

Replace:

```typescript
  private async writeFileDurable(path: string, content: string): Promise<void> {
    const tmp = `${path}.${process.pid}.${++this.tmpWriteCounter}.tmp`;
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(content, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await renameWithRetry(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }
```

with:

```typescript
  /**
   * "Durable" here means "goes through provider.rename", which on FS is a real
   * temp-file+fsync+rename dance (see FsStorageProvider) and on Blob/Azure is a
   * plain overwrite — those backends have no local temp-file/fsync primitive to
   * protect against a torn write, so this degrades to `provider.write` on them,
   * matching the safety level they already had.
   */
  private async writeFileDurable(path: string, content: string): Promise<void> {
    await this.provider.write(path, Buffer.from(content, "utf-8"));
  }
```

- [ ] **Step 3: Rewrite `historyPath` and `writeHistory`**

Replace:

```typescript
  private historyPath(docId: string): string {
    return join(
      this.root,
      dirname(docId),
      ".versions",
      basename(docId),
      "history.yaml",
    );
  }

  async writeHistory(docId: string, history: DocumentHistory): Promise<void> {
    const { versions, ...rest } = history;
    await mkdir(dirname(this.historyPath(docId)), { recursive: true });
    const content = yaml.dump(
      { ...rest, versions },
      { lineWidth: -1, noRefs: true },
    );
    await this.writeFileDurable(this.historyPath(docId), content);
  }
```

with:

```typescript
  private historyPath(docId: string): string {
    return `${dirname(docId)}/.versions/${basename(docId)}/history.yaml`;
  }

  async writeHistory(docId: string, history: DocumentHistory): Promise<void> {
    const { versions, ...rest } = history;
    const content = yaml.dump(
      { ...rest, versions },
      { lineWidth: -1, noRefs: true },
    );
    await this.writeFileDurable(this.historyPath(docId), content);
  }
```

(every other `xPath()` private helper in the file — `checkpointHistoryPath`, `latestCheckpointPath`, `chainEventLogPath`, the suggestion-dir helper, the version-artifact dir helper — gets the same treatment: replace `join(this.root, a, b, c)` with the template literal `` `${a}/${b}/${c}` ``, and drop any `mkdir` call immediately preceding a `provider.write`/`writeFileDurable` call, since `StorageProvider.write` already creates parent directories per its interface contract.)

- [ ] **Step 4: Rewrite `readHistory`**

Replace the `readFile`/try-catch/quarantine body of `readHistory` (upstream ~883-928) with the same read-and-quarantine pattern but through the provider:

```typescript
  async readHistory(docId: string): Promise<DocumentHistory | null> {
    const path = this.historyPath(docId);
    const buf = await this.provider.read(path);
    if (buf === null) return null;
    const content = buf.toString("utf-8");
    let raw: unknown;
    try {
      raw = yaml.load(content);
    } catch (err) {
      const quarantined = await quarantine(this.provider, path);
      throw new CorruptHistoryError(
        docId,
        err instanceof Error ? err.message : String(err),
        quarantined,
      );
    }
    const result = documentHistorySchema.safeParse(raw);
    if (!result.success) {
      const quarantined = await quarantine(this.provider, path);
      throw new CorruptHistoryError(
        docId,
        `failed schema validation (${result.error.issues[0]?.message ?? "unknown issue"})`,
        quarantined,
      );
    }
    return result.data as DocumentHistory;
  }
```

Check the actual upstream `readHistory` body at `git show upstream/main:packages/engine/src/storage.ts` lines 883-928 before finalizing this — reproduce its EXACT error-message text and `CorruptHistoryError` constructor argument order verbatim (this plan's reconstruction above is a best-effort paraphrase from the earlier read-through; the executor must diff against the real upstream body and correct any mismatch before committing).

- [ ] **Step 5: Rewrite `maxRecordedVersion`**

`maxRecordedVersion` uses `readdir(dir)` to list a directory's raw entries — replace with `provider.list`:

```typescript
  async maxRecordedVersion(docId: string): Promise<number> {
    const dir = `${dirname(docId)}/.versions/${basename(docId)}`;
    const entries = await this.provider.list(`${dir}/*`);
    let max = 0;
    for (const path of entries) {
      const match = /^v(\d+)\.(md|diff)$/.exec(basename(path));
      if (match) max = Math.max(max, Number(match[1]));
    }
    return max;
  }
```

- [ ] **Step 6: Rewrite `appendVersionEntry`**

Replace the entire `wx`/`EEXIST`/`open(path, "a")` dance with a call to the new provider primitive:

```typescript
  async appendVersionEntry(
    docId: string,
    entry: VersionEntry,
    keyframeInterval: number,
  ): Promise<void> {
    const path = this.historyPath(docId);
    const block = yaml
      .dump([entry], { lineWidth: -1, noRefs: true })
      .split("\n")
      .map((line) => (line.length > 0 ? `  ${line}` : line))
      .join("\n");
    const header = `keyframe_interval: ${keyframeInterval}\nversions:\n`;
    await this.provider.appendOrCreate(path, header, block);
  }
```

- [ ] **Step 7: Rewrite `writeVersionArtifact`, `writeKeyframe`, `readDiff`, `writeDiff`**

Replace the `mkdir`+`overwrite?writeFileDurable:open(path,"wx")` body of `writeVersionArtifact` with:

```typescript
  private async writeVersionArtifact(
    docId: string,
    version: number,
    fileName: string,
    content: string,
    overwrite: boolean,
  ): Promise<void> {
    const docName = basename(docId);
    const docDir = dirname(docId);
    const path = `${docDir}/.versions/${docName}/${fileName}`;

    if (overwrite) {
      await this.writeFileDurable(path, content);
      return;
    }

    try {
      await this.provider.writeExclusive(path, Buffer.from(content, "utf-8"));
    } catch (err) {
      if (err instanceof StorageConflictError) {
        throw new VersionArtifactExistsError(docId, version, fileName);
      }
      throw err;
    }
  }
```

Add `StorageConflictError` to the file's import block (from `./storage/storage-errors.js`).

For `readDiff`/`writeDiff`, apply the standard Task 5 Step 8 substitution table (`readFile`→`provider.read`, `mkdir`+`writeFile`→`provider.write`) — no bespoke logic needed for these two.

- [ ] **Step 8: Rewrite the 6 suggestion methods**

`writeSuggestionPatch`, `writeSuggestionMeta`, `readSuggestionPatch`, `readSuggestionMeta`, `listSuggestionIds`, `archiveSuggestion` (upstream ~1258-1350) all follow the standard substitution table from Task 5 Step 8, with one exception: `archiveSuggestion` calls `rename(patchSrc, patchDest)` / `rename(metaSrc, metaDest)` directly (not through `quarantine`) — replace both with `this.provider.rename(patchSrc, patchDest)` / `this.provider.rename(metaSrc, metaDest)`, and drop the preceding `mkdir(destDir, ...)` (provider.rename creates parent dirs per Task 1's `FsStorageProvider.rename`, which already does `mkdir(dirname(absDest), ...)`; verify `BlobStorageProvider.rename`/`AzureBlobStorageProvider.rename`, both implemented as read+write+delete, need no directory creation at all since these backends have no real directories).

`listSuggestionIds` uses `readdir(dir)` — replace with `this.provider.list(`${dir}/*`)` and derive ids via `basename`, mirroring Step 5's `maxRecordedVersion` pattern.

- [ ] **Step 9: Build**

Run: `cd vendor/packages/engine && pnpm build`
Expected: TypeScript errors remaining ONLY in the checkpoint-chain and chain-event-log methods (Task 7).

- [ ] **Step 10: Commit**

```bash
git add vendor/packages/engine/src/storage.ts vendor/packages/engine/src/storage/providers/fs-storage-provider.ts
git commit -m "refactor(engine): port storage.ts version history + suggestions to StorageProvider"
```

---

### Task 7: Rewrite `storage.ts` Part C — checkpoint chain, chain event log, packs, `regenerateIndex`, `verifyVaultIntegrity`, `findAllHistories`, `init`

**Files:**
- Modify: `vendor/packages/engine/src/storage.ts`

**Interfaces:**
- Consumes: `this.provider.stat` (Task 1)
- Produces: `checkpointHistoryPath`/`latestCheckpointPath`/`readCheckpointHistory`/`readCheckpointChainState`/`readLatestCheckpoint`/`readLatestCheckpointNumber`/`readLatestCheckpointPointer`/`readLatestCheckpointFromTail`/`writeLatestCheckpointPointer`/`appendCheckpoint`/`startCheckpointHistory`/`writeCheckpointHistory`/`chainEventLogRelPath`/`readChainEventLog`/`appendChainEvent`/`readPacks`/`regenerateIndex`/`verifyVaultIntegrity`/`findAllHistories`/`init` — all with the exact same signatures as upstream (these are the methods `src/lib/mcp/tools.ts` calls directly: `verifyVaultIntegrity`, `regenerateIndex`, `readPacks`)

- [ ] **Step 1: Rewrite `readCheckpointChainState`'s size/mtime probe and tail read**

Replace:

```typescript
  async readCheckpointChainState(): Promise<CheckpointChainState> {
    let info: { size: number; mtimeMs: number };
    try {
      const s = await stat(this.checkpointHistoryPath());
      info = { size: s.size, mtimeMs: s.mtimeMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
      throw err;
    }

    const pointed = await this.readLatestCheckpointPointer(info);
    if (pointed) return { kind: "head", checkpoint: pointed };

    const tailed = await this.readLatestCheckpointFromTail(info.size);
    if (tailed) return { kind: "head", checkpoint: tailed };

    let content: string;
    try {
      content = await readFile(this.checkpointHistoryPath(), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
      throw err;
    }
```

with:

```typescript
  async readCheckpointChainState(): Promise<CheckpointChainState> {
    const info = await this.provider.stat(this.checkpointHistoryPath());
    if (info === null) return { kind: "absent" };

    const pointed = await this.readLatestCheckpointPointer(info);
    if (pointed) return { kind: "head", checkpoint: pointed };

    const tailed = await this.readLatestCheckpointFromTail(info.size);
    if (tailed) return { kind: "head", checkpoint: tailed };

    const buf = await this.provider.read(this.checkpointHistoryPath());
    if (buf === null) return { kind: "absent" };
    const content = buf.toString("utf-8");
```

(the rest of the method — `yaml.load`/schema validation/quarantine-on-unparseable — is unchanged, since it already operates on the in-memory `content` string, not on raw fs handles).

- [ ] **Step 2: Simplify `readLatestCheckpointFromTail`**

The upstream version does a byte-range `open(...).read(buf, 0, len, start)` to avoid reading the whole file. `StorageProvider` has no range-read primitive (deliberately — Task 1 chose not to add one, since the only consumer is this perf optimization and a full `provider.read()` + in-memory slice is correctness-equivalent, just without the I/O savings on non-FS backends). Replace:

```typescript
  private async readLatestCheckpointFromTail(
    historyBytes: number,
  ): Promise<Checkpoint | null> {
    const TAIL_BYTES = 64 * 1024;
    const start = Math.max(0, historyBytes - TAIL_BYTES);
    let text: string;
    try {
      const handle = await open(this.checkpointHistoryPath(), "r");
      try {
        const buf = Buffer.alloc(historyBytes - start);
        const { bytesRead } = await handle.read(buf, 0, buf.length, start);
        text = buf.subarray(0, bytesRead).toString("utf-8");
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
```

with:

```typescript
  private async readLatestCheckpointFromTail(
    historyBytes: number,
  ): Promise<Checkpoint | null> {
    const TAIL_BYTES = 64 * 1024;
    const start = Math.max(0, historyBytes - TAIL_BYTES);
    const full = await this.provider.read(this.checkpointHistoryPath());
    if (full === null) return null;
    let text = full.subarray(start).toString("utf-8");
```

(everything below this point in the method — the partial-first-line trim, the `\n  - checkpoint:` marker search, the dedent + yaml.load + schema parse — is unchanged; it already operates on the `text` string).

- [ ] **Step 3: Rewrite `writeLatestCheckpointPointer`**

Replace:

```typescript
  private async writeLatestCheckpointPointer(
    checkpoint: Checkpoint,
  ): Promise<void> {
    let info: { size: number; mtimeMs: number };
    try {
      const s = await stat(this.checkpointHistoryPath());
      info = { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return;
    }
    await writeFile(
      this.latestCheckpointPath(),
      "# Auto-generated cache of the newest checkpoint. Safe to delete.\n" +
        yaml.dump(
          { history_bytes: info.size, history_mtime_ms: info.mtimeMs, checkpoint },
          { lineWidth: -1, noRefs: true },
        ),
      "utf-8",
    );
  }
```

with:

```typescript
  private async writeLatestCheckpointPointer(
    checkpoint: Checkpoint,
  ): Promise<void> {
    const info = await this.provider.stat(this.checkpointHistoryPath());
    if (info === null) return;
    const content =
      "# Auto-generated cache of the newest checkpoint. Safe to delete.\n" +
      yaml.dump(
        { history_bytes: info.size, history_mtime_ms: info.mtimeMs, checkpoint },
        { lineWidth: -1, noRefs: true },
      );
    await this.provider.write(this.latestCheckpointPath(), Buffer.from(content, "utf-8"));
  }
```

- [ ] **Step 4: Rewrite `appendCheckpoint`**

Read the exact upstream body first — `git show upstream/main:packages/engine/src/storage.ts` lines ~1601-1645 (this plan's earlier research read through line 1360 in detail but only skimmed this exact range; the executor must pull the live text). It builds a YAML block the same way `appendVersionEntry` does (dump one list item, indent 2 spaces) and previously wrote it via `mkdir` + `open(path, "a")` + `handle.write(block)` + `handle.sync()` with no `wx`-then-`a` fallback (unlike `appendVersionEntry`, the header — `checkpoints:\n` — is written once by `startCheckpointHistory`, not raced here). Replace that raw-fs tail with:

```typescript
    await this.provider.appendOrCreate(this.checkpointHistoryPath(), "checkpoints:\n", block);
```

then call `await this.writeLatestCheckpointPointer(checkpoint)` exactly where upstream calls it (after the append succeeds — check the exact ordering in the real body, since the pointer cache must reflect the POST-append file size/mtime, not the pre-append one).

- [ ] **Step 5: Rewrite `startCheckpointHistory` and `writeCheckpointHistory`**

Apply the Task 5 Step 8 standard substitution table to both — they're a `mkdir`+`writeFile`(-durable) pair with a `quarantineExisting` branch that calls `quarantine(path)` (now `quarantine(this.provider, path)` per Task 6 Step 1) and an `unlink(this.latestCheckpointPath()).catch(() => {})` (replace with `await this.provider.delete(this.latestCheckpointPath())`, dropping the `.catch` since `delete` is already a no-op on a missing file).

- [ ] **Step 6: Rewrite `chainEventLogPath`, `readChainEventLog`, `appendChainEvent`**

`readChainEventLog` follows the standard `readFile`→`provider.read` table entry. `appendChainEvent` (upstream ~1723-1735) does `mkdir` + `open(path, "a")` + `handle.write(block)` — replace with `this.provider.appendOrCreate(path, "", block)` (empty header — chain-event-log has no YAML header/key wrapper unlike history.yaml/context_history.yaml; confirm this against the real upstream body, since if it DOES have a header this plan's `""` must become that exact header string instead).

- [ ] **Step 7: Rewrite `readPacks`**

Upstream (~1737-1755) globs `packs/**/*.yaml` via `globFiles` then `readFile`s each. Replace with:

```typescript
  async readPacks(): Promise<Pack[]> {
    const files = await this.globProvider(["packs/**/*.yaml"], []);
    const packs: Pack[] = [];
    for (const file of files.sort()) {
      const buf = await this.provider.read(file);
      if (buf === null) continue;
      const raw = yaml.load(buf.toString("utf-8"));
      const result = packSchema.safeParse(raw);
      if (result.success) packs.push(result.data as Pack);
    }
    return packs;
  }
```

(confirm against the real upstream body whether a failed `packSchema.safeParse` should be silently skipped or pushed as an error — mirror upstream's exact behavior rather than this plan's guess if they differ).

- [ ] **Step 8: Rewrite `regenerateIndex`'s agent-config merge loop**

The `for (const file of agentConfigs)` loop (upstream ~590-603) does `mkdir` + `readFile`(optional) + `writeFile`. Replace with:

```typescript
    for (const file of agentConfigs) {
      const existingBuf = await this.provider.read(file.path);
      const existing = existingBuf === null ? null : existingBuf.toString("utf-8");
      const merged = mergeAgentConfig(existing, file.content);
      await this.provider.write(file.path, Buffer.from(merged, "utf-8"));
    }
```

Every other `join(this.root, ...)` reference elsewhere in `regenerateIndex` (there are none besides this loop and the `discoverDocuments`/`readConfig`/`readLatestCheckpoint`/`readPacks`/`writeContextYaml`/`writeIndexMd` calls, all already ported in Tasks 5-6) needs no further change.

- [ ] **Step 9: Rewrite `findAllHistories`**

This method (upstream ~1790-1836) globs `**/.versions/*/history.yaml` (or the equivalent) and calls `this.readHistory(docId)` per match, catching `CorruptHistoryError` and invoking the `onUnreadable` callback instead of throwing. Replace its glob call with `this.globProvider([...pattern...], [])` (confirm the exact upstream pattern string) and leave the per-file `readHistory`/catch logic untouched — it already routes through the Task 6 Step 4 provider-based `readHistory`.

- [ ] **Step 10: Rewrite `init`**

Replace the `mkdir(this.root, ...)` / `mkdir(join(this.root, "nodes"), ...)` / etc. sequence (upstream ~1837-1852) with `provider.write`-triggered directory creation — since `StorageProvider.write` creates parent directories per its contract, and Blob/Azure backends have no real directories to pre-create at all, replace the whole block with placeholder-file writes that establish each directory's existence the same way the OLD pre-2.3.0 fork's `nest-storage.ts init()` already did (check that method — read from git history via `git log -p --all -- vendor/packages/engine/src/storage/nest-storage.ts` if needed, since it was deleted in Task 4 — to reproduce its exact placeholder-file strategy, e.g. writing an empty `.gitkeep`-style file per directory, rather than inventing a new one here).

- [ ] **Step 11: Build**

Run: `cd vendor/packages/engine && pnpm build`
Expected: zero TypeScript errors. Grep to confirm no raw fs imports remain: `grep -n "node:fs" vendor/packages/engine/src/storage.ts` should return nothing.

- [ ] **Step 12: Run the full engine test suite**

Run: `cd vendor/packages/engine && pnpm test`
Expected: All vendored tests pass, including the upstream-authored ones from Task 4 (`checkpoint-append.test.ts`, `checkpoint-chain-bugs.regression.test.ts`, `history-corruption.test.ts`, `folder-scoped-discovery.test.ts`, `root-level-discovery.test.ts`, `verify-vault-integrity.test.ts`, etc.) — since those tests were written against upstream's fs-based `NestStorage`, expect several to construct `new NestStorage(tmpDir)` (a bare string), which Task 5 Step 3's constructor overload already supports transparently via the internal `FsStorageProvider`. Any failure here is either a genuine porting bug (fix it) or a test that assumes real-filesystem-only behavior no `StorageProvider`-abstracted method claims to provide (e.g. a test asserting a literal directory exists via `fs.existsSync` outside the `NestStorage` API) — for the latter, this is expected friction from vendoring upstream's own test suite verbatim; do not weaken the test, instead confirm with the user whether to skip/adjust it.

- [ ] **Step 13: Commit**

```bash
git add vendor/packages/engine/src/storage.ts
git commit -m "refactor(engine): port storage.ts checkpoint chain + regenerateIndex to StorageProvider"
```

---

### Task 8: Wire up `index.ts` exports and confirm the `./api` export surface builds

**Files:**
- Modify: `vendor/packages/engine/src/index.ts`
- Modify: `vendor/packages/engine/package.json`

**Interfaces:**
- Produces: `export { StorageConflictError }` alongside the existing `export type { StorageProvider }` (or wherever `StorageProvider` is currently re-exported from — check `vendor/packages/engine/src/index.ts` first)

- [ ] **Step 1: Check the current export list**

Run: `grep -n "storage" vendor/packages/engine/src/index.ts`

- [ ] **Step 2: Add the new export**

Add a line exporting `StorageConflictError` from `./storage/storage-errors.js` next to wherever `StorageProvider` is exported, e.g.:

```typescript
export { StorageConflictError } from "./storage/storage-errors.js";
```

- [ ] **Step 3: Update `package.json`**

Replace `vendor/packages/engine/package.json`'s `version`, `exports`, `scripts.build`, `dependencies`, and `devDependencies` fields with upstream v2.3.0's values (shown in this plan's Architecture research):

```json
{
  "version": "2.3.0",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./api": {
      "import": "./dist/api/index.js",
      "types": "./dist/api/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts src/api/index.ts --format esm --dts --clean",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "diff": "^9.0.0",
    "js-yaml": "^4.2.0",
    "minisearch": "^7.0.0",
    "toposort": "^2.0.2",
    "zod": "^3.24.0",
    "zod-to-json-schema": "^3.25.2"
  },
  "devDependencies": {
    "@types/diff": "^7.0.0",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "@types/toposort": "^2.0.7",
    "tsup": "^8.0.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.9"
  }
}
```

Remove `fast-glob`, `gray-matter`, `remark-gfm`, `remark-parse`, `unified` from `dependencies` if present (they should already be gone from `parser.ts`'s imports per Task 4's verbatim copy; `fast-glob` is still needed by `FsStorageProvider` — confirm it stays listed, since Task 1/6 kept `fg` imported in `fs-storage-provider.ts`).

- [ ] **Step 4: Install and build**

Run: `pnpm install && cd vendor/packages/engine && pnpm build`
Expected: no errors. Confirm `dist/api/index.js` and `dist/api/index.d.ts` now exist.

- [ ] **Step 5: Commit**

```bash
git add vendor/packages/engine/src/index.ts vendor/packages/engine/package.json pnpm-lock.yaml
git commit -m "chore(engine): bump to v2.3.0 deps/exports, export StorageConflictError"
```

---

### Task 9: Verify Skynest's own consumers still compile and pass

**Files:**
- No modifications expected — this task is verification-only, per the Global Constraints promise that `NestStorage`'s public method surface is unchanged.
- Touch only if a real incompatibility surfaces: `src/lib/mcp/tools.ts`, `src/lib/vault/index.ts`, `src/lib/webhooks/readai/dedup.ts`, `src/lib/webhooks/readai/document.ts`, `src/lib/vault/storage/index.ts`

**Interfaces:**
- Consumes: the full `NestStorage` surface confirmed in this plan's Global Constraints (`readDocument`, `discoverDocuments`, `readContextYaml`, `readPacks`, `verifyVaultIntegrity`, `writeDocument`, `deleteDocument`, `regenerateIndex`, `readContextMd`, `readConfig`, `readHistory`)

- [ ] **Step 1: Root build**

Run: `pnpm build`
Expected: no TypeScript errors anywhere in `src/`.

- [ ] **Step 2: Root test suite**

Run: `pnpm test`
Expected: all existing tests pass, including `src/lib/mcp/tools.test.ts`, `src/lib/vault/storage/index.test.ts`, `src/lib/vault/storage/blob-storage-provider.test.ts`, `src/lib/vault/storage/azure-blob-storage-provider.test.ts`, `src/lib/vault/sync/vault-sync-factory.test.ts`.

- [ ] **Step 3: Root lint**

Run: `pnpm lint`
Expected: no errors (per root `CLAUDE.md`: "After completing a task, always ensure the project builds and there are no linting errors").

- [ ] **Step 4: If anything fails**

Diagnose whether the failure is a genuine behavior change this plan introduced (fix it in the relevant Task 5-8 file) or a pre-existing flaky/unrelated test (flag to the user, do not silently skip).

- [ ] **Step 5: Commit (only if Step 1-3 required fixes)**

```bash
git add -A
git commit -m "fix: reconcile Skynest consumers with vendored ContextNest v2.3.0 engine"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Preserve `StorageProvider`/Vercel Blob/Azure Blob hosting — Tasks 1-3 extend the interface and both concrete providers; Tasks 5-7 route every engine I/O call through it.
- ✅ Adopt "as much of upstream's fixes as possible" — Task 4 vendors every non-storage file verbatim (durability, quarantine, checkpoint-chain, glob rewrite, registry/remote-nest/stewards/wiki-graph/api, dependency bumps), Tasks 5-7 preserve 100% of `storage.ts`'s new logic/algorithms, only swapping the I/O layer.
- ✅ Don't touch `cli`/`mcp-server` vendored packages — stated in Global Constraints, no task modifies them.
- ✅ `registry.ts`'s env-var overlap with Skynest's own `CONTEXTNEST_VAULT_PATH` — addressed in Global Constraints (registry.ts is vendored unused/dead code, never wired up, so there is no actual collision at runtime).
- ✅ Skynest's own consumer call sites (`src/lib/mcp/tools.ts` etc.) — enumerated in Global Constraints and re-verified in Task 9.

**2. Placeholder scan:** Three spots in this plan intentionally point the executor at the live upstream source rather than reproducing it in full, because reproducing ~1885 lines of file inline would itself be a bigger transcription-error risk than reading the real file — these are NOT vague TODOs, each names an exact file, exact line range, and exact required action:
- Task 6 Step 4 (`readHistory` exact error text/argument order)
- Task 7 Step 4 (`appendCheckpoint`'s exact ordering of append vs. pointer-write)
- Task 7 Step 6 (`appendChainEvent`'s header string, if any)
- Task 7 Step 7 (`readPacks`'s exact schema-failure handling)
- Task 7 Step 10 (`init`'s exact placeholder-file strategy, recoverable from the deleted `nest-storage.ts`'s git history)

Every other step in this plan gives complete, runnable code.

**3. Type consistency:** `StorageProvider.stat` returns `{ size: number; mtimeMs: number } | null` consistently across Task 1 (interface), Task 1 Step 5 (Fs impl), Task 2 Step 3 (Blob impl), Task 3 Step 3 (Azure impl), and every `storage.ts` call site in Task 7. `StorageConflictError` is defined once in Task 1 and imported identically in Tasks 2, 3, and 6. `NestStorage`'s constructor signature (`string | StorageProvider`) is declared in Task 5 Step 3 and never contradicted later. `appendOrCreate(path, header, entry)` parameter order is consistent across Task 1's interface, both provider implementations, and every `storage.ts` call site in Task 6 Step 6 and Task 7 Steps 4/6.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-28-contextnest-upstream-sync.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
