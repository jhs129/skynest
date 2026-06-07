# Service 1: Hosted Context Nest MCP Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel-hosted Next.js MCP server that exposes all Context Nest vault operations over HTTPS with GitHub OAuth 2.1 authentication, Vercel Blob storage, and per-user Git commit attribution.

**Architecture:** The upstream ContextNest engine's `NestStorage` is refactored to delegate I/O to an injected `StorageProvider` (vendor-only change, backward-compatible constructor overload). `BlobStorageProvider` and `GitVaultSyncProvider`/`GitHubVaultSyncProvider` live in `src/` only. The MCP server is Next.js 15 App Router + `mcp-handler` with a stateless OAuth 2.1 authorization server (no database: auth codes are short-lived JWTs, refresh tokens are omitted in MVP with 8h access token TTL).

**Tech Stack:** Next.js 15, mcp-handler 1.1.0, @modelcontextprotocol/sdk 1.26.0, next-auth 5.0.0-beta.30, @vercel/blob, jose 6.x, zod 3.x, vitest 2.x, pnpm workspaces.

**Reference:** OAuth 2.1 pattern — `jhs129/roadmap` (`src/lib/oauth/`, `src/app/oauth/`, `src/lib/mcp/auth.ts`). Read those files before implementing Tasks 9–11.

---

## File Map

### Vendor changes (storage abstraction only)
| File | Action |
|------|--------|
| `vendor/packages/engine/src/storage/storage-provider.ts` | CREATE — `StorageProvider` interface |
| `vendor/packages/engine/src/storage/providers/fs-storage-provider.ts` | CREATE — wraps `node:fs/promises` |
| `vendor/packages/engine/src/storage/storage-factory.ts` | CREATE — `createStorageProvider` (fs only in vendor) |
| `vendor/packages/engine/src/storage/nest-storage.ts` | CREATE — refactored `NestStorage` using provider |
| `vendor/packages/engine/src/storage.ts` | MODIFY — re-export from `./storage/nest-storage.js` |
| `vendor/packages/engine/src/index.ts` | MODIFY — export `StorageProvider`, `createStorageProvider` |

### src/ (all skynest-specific code)
| File | Action |
|------|--------|
| `services/contextnest-mcp-host/package.json` | CREATE |
| `services/contextnest-mcp-host/tsconfig.json` | CREATE |
| `services/contextnest-mcp-host/next.config.ts` | CREATE |
| `pnpm-workspace.yaml` (repo root) | CREATE |
| `services/contextnest-mcp-host/src/lib/vault/storage/blob-storage-provider.ts` | CREATE — Vercel Blob |
| `services/contextnest-mcp-host/src/lib/vault/storage/index.ts` | CREATE — `createStorageProvider` extended with blob |
| `services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-provider.ts` | CREATE — interface |
| `services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-factory.ts` | CREATE — factory |
| `services/contextnest-mcp-host/src/lib/vault/sync/providers/github-vault-sync-provider.ts` | CREATE |
| `services/contextnest-mcp-host/src/lib/vault/index.ts` | CREATE — `createEngine(userToken)` |
| `services/contextnest-mcp-host/src/lib/oauth/config.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/lib/oauth/keys.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/lib/oauth/jwt.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/lib/oauth/pkce.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/lib/oauth/tokens.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/lib/oauth/urls.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/lib/oauth/authorize.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/lib/auth.config.ts` | CREATE — GitHub provider |
| `services/contextnest-mcp-host/src/lib/auth.ts` | CREATE — NextAuth v5 |
| `services/contextnest-mcp-host/src/app/oauth/authorize/route.ts` | CREATE — port from roadmap |
| `services/contextnest-mcp-host/src/app/oauth/token/route.ts` | CREATE — port/simplify (no DB) |
| `services/contextnest-mcp-host/src/app/oauth/register/route.ts` | CREATE — port (in-memory clients) |
| `services/contextnest-mcp-host/src/app/.well-known/oauth-authorization-server/route.ts` | CREATE |
| `services/contextnest-mcp-host/src/app/.well-known/oauth-protected-resource/route.ts` | CREATE |
| `services/contextnest-mcp-host/src/app/.well-known/jwks.json/route.ts` | CREATE |
| `services/contextnest-mcp-host/src/lib/mcp/auth.ts` | CREATE — `verifyMcpToken` |
| `services/contextnest-mcp-host/src/lib/mcp/tools.ts` | CREATE — all 22 tools |
| `services/contextnest-mcp-host/src/app/api/mcp/route.ts` | CREATE — `/api/mcp` endpoint |
| `scripts/init-vault.sh` | MODIFY — replace existing stub |

---

## Task 1: pnpm workspace + Next.js app scaffold

**Files:**
- Create: `pnpm-workspace.yaml` (repo root)
- Create: `services/contextnest-mcp-host/package.json`
- Create: `services/contextnest-mcp-host/tsconfig.json`
- Create: `services/contextnest-mcp-host/next.config.ts`

- [ ] **Step 1: Create root pnpm-workspace.yaml**

```yaml
# pnpm-workspace.yaml (repo root)
packages:
  - 'services/*'
  - 'services/contextnest-mcp-host/vendor/packages/*'
```

- [ ] **Step 2: Create package.json for the Next.js service**

```json
{
  "name": "contextnest-mcp-host",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "oauth:gen-keypair": "tsx scripts/oauth-gen-keypair.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.26.0",
    "@promptowl/contextnest-engine": "workspace:*",
    "@vercel/blob": "^0.26.0",
    "jose": "^6.0.0",
    "mcp-handler": "1.1.0",
    "next": "15.3.3",
    "next-auth": "5.0.0-beta.30",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tsx": "^4.19.2",
    "typescript": "^5",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "vendor"]
}
```

- [ ] **Step 4: Create next.config.ts**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['@promptowl/contextnest-engine'],
};

export default config;
```

- [ ] **Step 5: Install dependencies**

```bash
cd /path/to/skynest
pnpm install
```

Expected: packages installed, no errors. The `@promptowl/contextnest-engine` workspace package resolves from `vendor/packages/engine`.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml services/contextnest-mcp-host/package.json services/contextnest-mcp-host/tsconfig.json services/contextnest-mcp-host/next.config.ts
git commit -m "feat: bootstrap contextnest-mcp-host Next.js app with pnpm workspace"
```

---

## Task 2: StorageProvider interface + FsStorageProvider (vendor)

**Files:**
- Create: `vendor/packages/engine/src/storage/storage-provider.ts`
- Create: `vendor/packages/engine/src/storage/providers/fs-storage-provider.ts`
- Test: `vendor/packages/engine/src/__tests__/storage-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// vendor/packages/engine/src/__tests__/storage-provider.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorageProvider } from '../storage/providers/fs-storage-provider.js';

let dir: string;
let provider: FsStorageProvider;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cn-test-'));
  provider = new FsStorageProvider(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('FsStorageProvider', () => {
  it('returns null for a missing file', async () => {
    expect(await provider.read('nodes/missing.md')).toBeNull();
  });

  it('round-trips write + read', async () => {
    await provider.write('nodes/doc.md', Buffer.from('hello'));
    const result = await provider.read('nodes/doc.md');
    expect(result?.toString()).toBe('hello');
  });

  it('creates parent directories on write', async () => {
    await provider.write('deep/nested/doc.md', Buffer.from('x'));
    expect(await provider.exists('deep/nested/doc.md')).toBe(true);
  });

  it('delete removes a file', async () => {
    await provider.write('nodes/doc.md', Buffer.from('x'));
    await provider.delete('nodes/doc.md');
    expect(await provider.exists('nodes/doc.md')).toBe(false);
  });

  it('list returns vault-relative paths under a prefix', async () => {
    await provider.write('nodes/a.md', Buffer.from('a'));
    await provider.write('nodes/b.md', Buffer.from('b'));
    await provider.write('sources/c.md', Buffer.from('c'));
    const result = await provider.list('nodes/**/*.md');
    expect(result.sort()).toEqual(['nodes/a.md', 'nodes/b.md']);
  });

  it('rename moves a file', async () => {
    await provider.write('nodes/old.md', Buffer.from('x'));
    await provider.rename('nodes/old.md', 'nodes/new.md');
    expect(await provider.exists('nodes/old.md')).toBe(false);
    expect(await provider.exists('nodes/new.md')).toBe(true);
  });

  it('deleteDir removes all files under a prefix', async () => {
    await provider.write('_suggestions/doc/s1.patch', Buffer.from('p'));
    await provider.write('_suggestions/doc/s1.meta.yaml', Buffer.from('m'));
    await provider.deleteDir('_suggestions/doc');
    expect(await provider.list('_suggestions/**/*')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/contextnest-mcp-host/vendor
pnpm --filter @promptowl/contextnest-engine test
```

Expected: FAIL — `FsStorageProvider` not found.

- [ ] **Step 3: Create the StorageProvider interface**

```ts
// vendor/packages/engine/src/storage/storage-provider.ts
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
```

- [ ] **Step 4: Create FsStorageProvider**

```ts
// vendor/packages/engine/src/storage/providers/fs-storage-provider.ts
import {
  readFile, writeFile, mkdir, unlink, rename, rm, access,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import fg from 'fast-glob';
import type { StorageProvider } from '../storage-provider.js';

export class FsStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, path);
  }

  async read(path: string): Promise<Buffer | null> {
    try {
      return await readFile(this.abs(path));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }

  async delete(path: string): Promise<void> {
    try {
      await unlink(this.abs(path));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async deleteDir(prefix: string): Promise<void> {
    try {
      await rm(this.abs(prefix), { recursive: true, force: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const absDest = this.abs(to);
    await mkdir(dirname(absDest), { recursive: true });
    await rename(this.abs(from), absDest);
  }

  async list(pattern: string): Promise<string[]> {
    const results = await fg(pattern, { cwd: this.root, onlyFiles: true });
    return results.sort();
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd services/contextnest-mcp-host/vendor
pnpm --filter @promptowl/contextnest-engine test
```

Expected: PASS — all FsStorageProvider tests green.

- [ ] **Step 6: Commit**

```bash
git add services/contextnest-mcp-host/vendor/packages/engine/src/storage/
git commit -m "feat(vendor): add StorageProvider interface and FsStorageProvider"
```

---

## Task 3: StorageFactory (vendor) + BlobStorageProvider (src)

**Files:**
- Create: `vendor/packages/engine/src/storage/storage-factory.ts`
- Create: `services/contextnest-mcp-host/src/lib/vault/storage/blob-storage-provider.ts`
- Create: `services/contextnest-mcp-host/src/lib/vault/storage/index.ts`
- Test: `services/contextnest-mcp-host/src/lib/vault/storage/blob-storage-provider.test.ts`

- [ ] **Step 1: Create the vendor StorageFactory (fs only)**

```ts
// vendor/packages/engine/src/storage/storage-factory.ts
import { FsStorageProvider } from './providers/fs-storage-provider.js';
import type { StorageProvider } from './storage-provider.js';

export interface StorageProviderConfig {
  backend: string;
  vaultPath?: string;
}

/**
 * Base factory — handles 'fs' only.
 * The 'blob' backend is registered in the host application (src/lib/vault/storage/index.ts)
 * to keep Vercel-specific dependencies out of the vendor tree.
 */
export function createStorageProvider(config: StorageProviderConfig): StorageProvider {
  if (config.backend === 'fs') {
    if (!config.vaultPath) throw new Error('vaultPath required for fs backend');
    return new FsStorageProvider(config.vaultPath);
  }
  throw new Error(`Unknown storage backend: "${config.backend}". Register custom backends in your host application.`);
}
```

- [ ] **Step 2: Write failing BlobStorageProvider tests**

```ts
// services/contextnest-mcp-host/src/lib/vault/storage/blob-storage-provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlobStorageProvider } from './blob-storage-provider.js';

// Mock @vercel/blob
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
  head: vi.fn(),
}));

import { put, del, list, head } from '@vercel/blob';
const mockPut = vi.mocked(put);
const mockDel = vi.mocked(del);
const mockList = vi.mocked(list);
const mockHead = vi.mocked(head);

describe('BlobStorageProvider', () => {
  let provider: BlobStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BlobStorageProvider({ prefix: 'vault' });
  });

  it('read returns null when blob does not exist', async () => {
    mockHead.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    expect(await provider.read('nodes/doc.md')).toBeNull();
  });

  it('read fetches blob content as Buffer', async () => {
    const url = 'https://store.blob.vercel-storage.com/vault/nodes/doc.md';
    mockHead.mockResolvedValue({ url, pathname: 'vault/nodes/doc.md', size: 5, uploadedAt: new Date(), downloadUrl: url, contentType: 'text/plain', cacheControl: '' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('hello').buffer,
    }) as unknown as typeof fetch;
    const result = await provider.read('nodes/doc.md');
    expect(result?.toString()).toBe('hello');
  });

  it('write calls put with correct key and access', async () => {
    mockPut.mockResolvedValue({ url: 'https://example.com/vault/nodes/doc.md', pathname: 'vault/nodes/doc.md', contentType: 'application/octet-stream', contentDisposition: '', size: 5, uploadedAt: new Date(), cacheControl: '' });
    await provider.write('nodes/doc.md', Buffer.from('hello'));
    expect(mockPut).toHaveBeenCalledWith(
      'vault/nodes/doc.md',
      expect.any(Buffer),
      { access: 'private', addRandomSuffix: false }
    );
  });

  it('delete lists then deletes by url', async () => {
    const url = 'https://store.blob.vercel-storage.com/vault/nodes/doc.md';
    mockList.mockResolvedValue({ blobs: [{ url, pathname: 'vault/nodes/doc.md', size: 5, uploadedAt: new Date(), downloadUrl: url }], cursor: undefined, hasMore: false });
    mockDel.mockResolvedValue(undefined);
    await provider.delete('nodes/doc.md');
    expect(mockDel).toHaveBeenCalledWith([url]);
  });

  it('list returns vault-relative paths (prefix stripped)', async () => {
    mockList.mockResolvedValue({
      blobs: [
        { url: 'u1', pathname: 'vault/nodes/a.md', size: 1, uploadedAt: new Date(), downloadUrl: 'u1' },
        { url: 'u2', pathname: 'vault/nodes/b.md', size: 1, uploadedAt: new Date(), downloadUrl: 'u2' },
      ],
      cursor: undefined,
      hasMore: false,
    });
    const result = await provider.list('nodes/');
    expect(result).toEqual(['nodes/a.md', 'nodes/b.md']);
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd services/contextnest-mcp-host
pnpm test
```

Expected: FAIL — `BlobStorageProvider` not found.

- [ ] **Step 4: Create BlobStorageProvider**

```ts
// services/contextnest-mcp-host/src/lib/vault/storage/blob-storage-provider.ts
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
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 5: Create src storage index (extends vendor factory with blob)**

```ts
// services/contextnest-mcp-host/src/lib/vault/storage/index.ts
import { BlobStorageProvider } from './blob-storage-provider.js';
import type { StorageProvider } from '@promptowl/contextnest-engine';

export function createStorageProvider(): StorageProvider {
  const backend = process.env.CONTEXTNEST_STORAGE ?? 'blob';

  if (backend === 'blob') {
    const prefix = process.env.CONTEXTNEST_BLOB_PREFIX;
    if (!prefix) throw new Error('CONTEXTNEST_BLOB_PREFIX env var is required when CONTEXTNEST_STORAGE=blob');
    return new BlobStorageProvider({ prefix });
  }

  if (backend === 'fs') {
    // Import lazily so @vercel/blob is not required in fs-only environments
    const { FsStorageProvider } = require('@promptowl/contextnest-engine/storage');
    const vaultPath = process.env.CONTEXTNEST_VAULT_PATH;
    if (!vaultPath) throw new Error('CONTEXTNEST_VAULT_PATH env var is required when CONTEXTNEST_STORAGE=fs');
    return new FsStorageProvider(vaultPath);
  }

  throw new Error(`Unknown CONTEXTNEST_STORAGE value: "${backend}"`);
}
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd services/contextnest-mcp-host
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add vendor/packages/engine/src/storage/storage-factory.ts \
        services/contextnest-mcp-host/src/lib/vault/storage/
git commit -m "feat: add StorageFactory (vendor) and BlobStorageProvider (src)"
```

---

## Task 4: NestStorage refactor (vendor)

This is the largest vendor change. `NestStorage` currently calls `fs/promises` directly. We inject a `StorageProvider` and delegate all I/O through it. The constructor overload keeps all existing `new NestStorage(root)` call sites working without changes.

**Files:**
- Create: `vendor/packages/engine/src/storage/nest-storage.ts`
- Modify: `vendor/packages/engine/src/storage.ts`
- Modify: `vendor/packages/engine/src/index.ts`

- [ ] **Step 1: Verify existing engine tests pass before touching anything**

```bash
cd services/contextnest-mcp-host/vendor
pnpm --filter @promptowl/contextnest-engine test
```

Expected: all existing tests PASS. If any are already failing, stop and investigate before proceeding.

- [ ] **Step 2: Create `nest-storage.ts` — copy `storage.ts` then refactor**

Start by copying the entire content of `vendor/packages/engine/src/storage.ts` to `vendor/packages/engine/src/storage/nest-storage.ts`. Then apply these mechanical changes:

**a) Replace the imports at the top:**

Remove:
```ts
import { readFile, writeFile, mkdir, stat, unlink, rm, rename } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import fg from "fast-glob";
```

Add:
```ts
import { join } from "node:path";
import type { StorageProvider } from './storage-provider.js';
import { FsStorageProvider } from './providers/fs-storage-provider.js';
```

**b) Change the constructor to accept string or provider:**

Replace:
```ts
export class NestStorage {
  constructor(public readonly root: string) {}
```

With:
```ts
export class NestStorage {
  private readonly provider: StorageProvider;
  public readonly root: string;

  constructor(rootOrProvider: string | StorageProvider) {
    if (typeof rootOrProvider === 'string') {
      this.root = rootOrProvider;
      this.provider = new FsStorageProvider(rootOrProvider);
    } else {
      this.root = '';
      this.provider = rootOrProvider;
    }
  }
```

**c) Replace all direct `fs.*` calls throughout the class body.**

Apply this substitution pattern for every occurrence:

| Old pattern | New pattern |
|---|---|
| `readFile(join(this.root, relPath), 'utf-8')` | `(await this.provider.read(relPath))?.toString('utf-8') ?? null` |
| `readFile(join(this.root, relPath))` | `await this.provider.read(relPath)` |
| `writeFile(join(this.root, relPath), content, 'utf-8')` | `await this.provider.write(relPath, Buffer.from(content, 'utf-8'))` |
| `writeFile(join(this.root, relPath), content)` | `await this.provider.write(relPath, Buffer.isBuffer(content) ? content : Buffer.from(content))` |
| `mkdir(dirname(join(this.root, relPath)), { recursive: true })` | *(delete — provider handles directory creation)* |
| `unlink(join(this.root, relPath))` | `await this.provider.delete(relPath)` |
| `rm(join(this.root, relPath), { recursive: true, force: true })` | `await this.provider.deleteDir(relPath)` |
| `rename(join(this.root, from), join(this.root, to))` | `await this.provider.rename(from, to)` |
| `fg(pattern, { cwd: this.root, ... })` | `await this.provider.list(pattern)` |
| `stat(join(this.root, relPath))` for existence | `await this.provider.exists(relPath)` |

Also remove any `join(this.root, ...)` wrappers where you've already used the vault-relative path — the provider takes vault-relative paths directly.

- [ ] **Step 3: Update `storage.ts` to re-export from the new location**

Replace the entire content of `vendor/packages/engine/src/storage.ts` with:

```ts
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
```

- [ ] **Step 4: Update `index.ts` to re-export the new types**

In `vendor/packages/engine/src/index.ts`, add these exports near the storage section:

```ts
export { type StorageProvider, createStorageProvider, FsStorageProvider } from './storage.js';
```

- [ ] **Step 5: Run all vendor tests — expect pass**

```bash
cd services/contextnest-mcp-host/vendor
pnpm --filter @promptowl/contextnest-engine test
```

Expected: all existing tests PASS (they use `new NestStorage(root)` which still works via the overloaded constructor).

If tests fail due to remaining direct `fs` calls, grep for `readFile\|writeFile\|unlink\|mkdir\|stat\|rm\|rename\|fast-glob` inside `nest-storage.ts` and fix each remaining occurrence.

- [ ] **Step 6: Commit**

```bash
git add services/contextnest-mcp-host/vendor/packages/engine/src/
git commit -m "feat(vendor): refactor NestStorage to delegate I/O to StorageProvider"
```

---

## Task 5: GitVaultSyncProvider interface + GitVaultSyncFactory

**Files:**
- Create: `services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-provider.ts`
- Create: `services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-factory.ts`
- Test: `services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-factory.test.ts
import { describe, it, expect } from 'vitest';

describe('createGitVaultSyncProvider', () => {
  it('returns a GitHubVaultSyncProvider when provider is "github"', async () => {
    process.env.VAULT_SYNC_PROVIDER = 'github';
    process.env.VAULT_REPO = 'owner/repo';
    process.env.VAULT_BRANCH = 'main';
    const { createGitVaultSyncProvider } = await import('./git-vault-sync-factory.js');
    const { GitHubVaultSyncProvider } = await import('./providers/github-vault-sync-provider.js');
    const provider = createGitVaultSyncProvider();
    expect(provider).toBeInstanceOf(GitHubVaultSyncProvider);
  });

  it('throws for unknown provider', async () => {
    process.env.VAULT_SYNC_PROVIDER = 'unknown-provider';
    const { createGitVaultSyncProvider } = await import('./git-vault-sync-factory.js');
    expect(() => createGitVaultSyncProvider()).toThrow('Unknown VAULT_SYNC_PROVIDER');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/contextnest-mcp-host && pnpm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the GitVaultSyncProvider interface**

```ts
// services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-provider.ts
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
```

- [ ] **Step 4: Create the factory (stub — GitHubVaultSyncProvider comes in Task 6)**

```ts
// services/contextnest-mcp-host/src/lib/vault/sync/git-vault-sync-factory.ts
import type { GitVaultSyncProvider } from './git-vault-sync-provider.js';

export function createGitVaultSyncProvider(): GitVaultSyncProvider {
  const providerName = process.env.VAULT_SYNC_PROVIDER ?? 'github';

  if (providerName === 'github') {
    const { GitHubVaultSyncProvider } = require('./providers/github-vault-sync-provider.js');
    const repo = process.env.VAULT_REPO;
    const branch = process.env.VAULT_BRANCH ?? 'main';
    if (!repo) throw new Error('VAULT_REPO env var is required');
    return new GitHubVaultSyncProvider({ repo, branch });
  }

  throw new Error(`Unknown VAULT_SYNC_PROVIDER: "${providerName}"`);
}
```

- [ ] **Step 5: Run tests — expect them to still fail (GitHubVaultSyncProvider not yet created) — that's fine for now, proceed to Task 6**

---

## Task 6: GitHubVaultSyncProvider

**Files:**
- Create: `services/contextnest-mcp-host/src/lib/vault/sync/providers/github-vault-sync-provider.ts`
- Test: `services/contextnest-mcp-host/src/lib/vault/sync/providers/github-vault-sync-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/contextnest-mcp-host/src/lib/vault/sync/providers/github-vault-sync-provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubVaultSyncProvider } from './github-vault-sync-provider.js';

const fetchMock = vi.fn();
global.fetch = fetchMock;

const provider = new GitHubVaultSyncProvider({ repo: 'owner/testrepo', branch: 'main' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubVaultSyncProvider.commitFile', () => {
  it('creates a new file when no SHA exists', async () => {
    // HEAD returns 404 (file does not exist)
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) }) // GET sha
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'abc123' } }) }); // PUT

    await provider.commitFile({
      path: 'nodes/new-doc.md',
      content: Buffer.from('# New Doc'),
      message: 'create new-doc',
      userToken: 'ghp_testtoken',
    });

    const putCall = fetchMock.mock.calls[1];
    const body = JSON.parse(putCall[1].body);
    expect(putCall[0]).toContain('/repos/owner/testrepo/contents/nodes/new-doc.md');
    expect(body.message).toBe('create new-doc');
    expect(body.sha).toBeUndefined(); // no sha for new file
    expect(body.branch).toBe('main');
    expect(putCall[1].headers.Authorization).toBe('Bearer ghp_testtoken');
  });

  it('includes SHA when updating an existing file', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'existing-sha' }) }) // GET sha
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'new-sha' } }) }); // PUT

    await provider.commitFile({
      path: 'nodes/existing.md',
      content: Buffer.from('updated'),
      message: 'update existing',
      userToken: 'ghp_testtoken',
    });

    const putCall = fetchMock.mock.calls[1];
    const body = JSON.parse(putCall[1].body);
    expect(body.sha).toBe('existing-sha');
  });

  it('does not throw on GitHub API failure (fire-and-forget)', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    await expect(provider.commitFile({
      path: 'nodes/doc.md',
      content: Buffer.from('x'),
      message: 'test',
      userToken: 'ghp_testtoken',
    })).resolves.toBeUndefined();
  });
});

describe('GitHubVaultSyncProvider.deleteFile', () => {
  it('fetches SHA then sends DELETE commit', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'del-sha' }) }) // GET sha
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // DELETE

    await provider.deleteFile({
      path: 'nodes/old.md',
      message: 'delete old',
      userToken: 'ghp_testtoken',
    });

    const deleteCall = fetchMock.mock.calls[1];
    const body = JSON.parse(deleteCall[1].body);
    expect(deleteCall[1].method).toBe('DELETE');
    expect(body.sha).toBe('del-sha');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/contextnest-mcp-host && pnpm test
```

Expected: FAIL.

- [ ] **Step 3: Create GitHubVaultSyncProvider**

```ts
// services/contextnest-mcp-host/src/lib/vault/sync/providers/github-vault-sync-provider.ts
import type { GitVaultSyncProvider } from '../git-vault-sync-provider.js';

interface Config {
  repo: string;   // "owner/repo"
  branch: string; // e.g. "main"
}

export class GitHubVaultSyncProvider implements GitVaultSyncProvider {
  private shaCache = new Map<string, string>();

  constructor(private readonly config: Config) {}

  private apiUrl(path: string): string {
    return `https://api.github.com/repos/${this.config.repo}/contents/${path}`;
  }

  private headers(userToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  private async fetchSha(path: string, userToken: string): Promise<string | undefined> {
    if (this.shaCache.has(path)) return this.shaCache.get(path);
    try {
      const res = await fetch(
        `${this.apiUrl(path)}?ref=${this.config.branch}`,
        { headers: this.headers(userToken) }
      );
      if (!res.ok) return undefined;
      const data = await res.json() as { sha?: string };
      if (data.sha) this.shaCache.set(path, data.sha);
      return data.sha;
    } catch {
      return undefined;
    }
  }

  async commitFile(params: { path: string; content: Buffer; message: string; userToken: string }): Promise<void> {
    try {
      const sha = await this.fetchSha(params.path, params.userToken);
      const body: Record<string, unknown> = {
        message: params.message,
        content: params.content.toString('base64'),
        branch: this.config.branch,
      };
      if (sha) body.sha = sha;

      const res = await fetch(this.apiUrl(params.path), {
        method: 'PUT',
        headers: this.headers(params.userToken),
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json() as { content?: { sha?: string } };
        if (data.content?.sha) this.shaCache.set(params.path, data.content.sha);
      } else {
        this.shaCache.delete(params.path);
        console.error(`[GitHubVaultSync] PUT failed: ${res.status} ${params.path}`);
      }
    } catch (err) {
      this.shaCache.delete(params.path);
      console.error(`[GitHubVaultSync] commitFile error:`, err);
    }
  }

  async deleteFile(params: { path: string; message: string; userToken: string }): Promise<void> {
    try {
      const sha = await this.fetchSha(params.path, params.userToken);
      if (!sha) return; // file doesn't exist in git — nothing to delete

      const res = await fetch(this.apiUrl(params.path), {
        method: 'DELETE',
        headers: this.headers(params.userToken),
        body: JSON.stringify({
          message: params.message,
          sha,
          branch: this.config.branch,
        }),
      });

      this.shaCache.delete(params.path);
      if (!res.ok) {
        console.error(`[GitHubVaultSync] DELETE failed: ${res.status} ${params.path}`);
      }
    } catch (err) {
      this.shaCache.delete(params.path);
      console.error(`[GitHubVaultSync] deleteFile error:`, err);
    }
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/contextnest-mcp-host && pnpm test
```

Expected: PASS — all GitHubVaultSyncProvider and factory tests green.

- [ ] **Step 5: Commit**

```bash
git add services/contextnest-mcp-host/src/lib/vault/sync/
git commit -m "feat: add GitVaultSyncProvider interface, factory, and GitHubVaultSyncProvider"
```

---

## Task 7: Engine factory — createEngine()

**Files:**
- Create: `services/contextnest-mcp-host/src/lib/vault/index.ts`
- Test: `services/contextnest-mcp-host/src/lib/vault/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/contextnest-mcp-host/src/lib/vault/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./storage/index.js', () => ({
  createStorageProvider: vi.fn(() => ({ read: vi.fn(), write: vi.fn(), delete: vi.fn(), deleteDir: vi.fn(), rename: vi.fn(), list: vi.fn(), exists: vi.fn() })),
}));

vi.mock('./sync/git-vault-sync-factory.js', () => ({
  createGitVaultSyncProvider: vi.fn(() => ({ commitFile: vi.fn(), deleteFile: vi.fn() })),
}));

vi.mock('@promptowl/contextnest-engine', () => ({
  NestStorage: vi.fn().mockImplementation(() => ({})),
}));

describe('createEngine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('constructs a NestStorage with the storage provider', async () => {
    const { createEngine } = await import('./index.js');
    const { NestStorage } = await import('@promptowl/contextnest-engine');
    const { createStorageProvider } = await import('./storage/index.js');

    createEngine('ghp_testtoken');

    expect(createStorageProvider).toHaveBeenCalledOnce();
    expect(NestStorage).toHaveBeenCalledWith(expect.objectContaining({ read: expect.any(Function) }));
  });

  it('returns an object with storage and sync', async () => {
    const { createEngine } = await import('./index.js');
    const result = createEngine('ghp_testtoken');
    expect(result).toHaveProperty('storage');
    expect(result).toHaveProperty('sync');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd services/contextnest-mcp-host && pnpm test
```

- [ ] **Step 3: Create vault/index.ts**

```ts
// services/contextnest-mcp-host/src/lib/vault/index.ts
import { NestStorage } from '@promptowl/contextnest-engine';
import { createStorageProvider } from './storage/index.js';
import { createGitVaultSyncProvider } from './sync/git-vault-sync-factory.js';
import type { GitVaultSyncProvider } from './sync/git-vault-sync-provider.js';

export interface VaultEngine {
  storage: NestStorage;
  sync: GitVaultSyncProvider;
  userToken: string;
}

/**
 * Create a fully configured vault engine for a single request.
 * Each tool call gets its own instance — stateless, correct attribution per call.
 */
export function createEngine(userToken: string): VaultEngine {
  const provider = createStorageProvider();
  const storage = new NestStorage(provider);
  const sync = createGitVaultSyncProvider();
  return { storage, sync, userToken };
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd services/contextnest-mcp-host && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add services/contextnest-mcp-host/src/lib/vault/index.ts services/contextnest-mcp-host/src/lib/vault/index.test.ts
git commit -m "feat: add createEngine factory wiring storage + git vault sync"
```

---

## Task 8: OAuth infrastructure (port from roadmap)

Port the OAuth 2.1 signing/key/config utilities from `jhs129/roadmap/src/lib/oauth/`. These files are mostly identical; the only changes are noted.

**Files:**
- Create: `src/lib/oauth/config.ts`
- Create: `src/lib/oauth/keys.ts`
- Create: `src/lib/oauth/jwt.ts`
- Create: `src/lib/oauth/pkce.ts`
- Create: `src/lib/oauth/tokens.ts`
- Create: `src/lib/oauth/urls.ts`
- Create: `src/lib/oauth/authorize.ts`
- Create: `scripts/oauth-gen-keypair.ts`

All files are in `services/contextnest-mcp-host/`.

- [ ] **Step 1: Copy `config.ts` from roadmap and change scopes + token TTLs**

```ts
// services/contextnest-mcp-host/src/lib/oauth/config.ts
export const OAUTH_SCOPES = ['mcp:read', 'mcp:write'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;  // 8 hours (no refresh tokens in MVP)
export const AUTH_CODE_TTL_SECONDS = 60;               // 1 minute
export const OAUTH_ALGORITHM = 'RS256' as const;

/** Resource identifier — audience claim in access tokens. */
export function getResourceUrl(host: string): string {
  return `https://${host}/api/mcp`;
}
```

- [ ] **Step 2: Copy `keys.ts` from roadmap unchanged**

Copy `jhs129/roadmap/src/lib/oauth/keys.ts` verbatim to `services/contextnest-mcp-host/src/lib/oauth/keys.ts`. This file loads `OAUTH_JWT_PRIVATE_KEY` / `OAUTH_JWT_PUBLIC_KEY` from env and exports `getPrivateKey()`, `getPublicKey()`, `getJwks()`.

- [ ] **Step 3: Copy `jwt.ts` from roadmap — update claims type**

Copy `jhs129/roadmap/src/lib/oauth/jwt.ts` to `src/lib/oauth/jwt.ts`. Change the `AccessTokenExtra` type to match skynest's identity shape:

```ts
// In jwt.ts — replace the extra claims interface:
export interface AccessTokenExtra {
  userToken: string;   // GitHub OAuth access token with repo scope
  userLogin: string;   // GitHub username
}
```

The `signAccessToken` and `verifyAccessToken` functions remain identical.

- [ ] **Step 4: Copy `pkce.ts`, `tokens.ts`, `urls.ts`, `authorize.ts` from roadmap unchanged**

These files have no project-specific logic. Copy verbatim:
- `pkce.ts` — PKCE S256 verification
- `tokens.ts` — opaque token generation + hashing
- `urls.ts` — per-request URL resolution (x-forwarded-host aware)
- `authorize.ts` — authorization parameter parsing + redirect URI validation

- [ ] **Step 5: Copy oauth-gen-keypair script from roadmap**

Copy `jhs129/roadmap/scripts/oauth-gen-keypair.ts` to `services/contextnest-mcp-host/scripts/oauth-gen-keypair.ts`. This script generates an RSA keypair and prints them formatted for env vars.

- [ ] **Step 6: Run the keypair generator to verify it works**

```bash
cd services/contextnest-mcp-host
pnpm oauth:gen-keypair
```

Expected: prints `OAUTH_JWT_PRIVATE_KEY=...` and `OAUTH_JWT_PUBLIC_KEY=...` (long base64 strings). Save these for `.env.local`.

- [ ] **Step 7: Commit**

```bash
git add services/contextnest-mcp-host/src/lib/oauth/ services/contextnest-mcp-host/scripts/
git commit -m "feat: add OAuth 2.1 infrastructure (keys, jwt, pkce, tokens — ported from roadmap)"
```

---

## Task 9: NextAuth + OAuth endpoints

**Files:**
- Create: `src/lib/auth.config.ts`
- Create: `src/lib/auth.ts`
- Create: `src/app/oauth/authorize/route.ts`
- Create: `src/app/oauth/token/route.ts`
- Create: `src/app/oauth/register/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Create: `src/app/.well-known/jwks.json/route.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

All files are in `services/contextnest-mcp-host/`.

- [ ] **Step 1: Create auth.config.ts with GitHub provider**

```ts
// services/contextnest-mcp-host/src/lib/auth.config.ts
import type { NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';

export const authConfig: NextAuthConfig = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: { scope: 'read:user user:email repo' },
      },
    }),
  ],
  callbacks: {
    jwt({ token, account }) {
      // Persist GitHub access token in the JWT so it's available in sessions
      if (account?.access_token) {
        token.githubAccessToken = account.access_token;
        token.githubLogin = (account as { login?: string }).login ?? token.name;
      }
      return token;
    },
    session({ session, token }) {
      (session as typeof session & { githubAccessToken?: string; githubLogin?: string }).githubAccessToken = token.githubAccessToken as string | undefined;
      (session as typeof session & { githubAccessToken?: string; githubLogin?: string }).githubLogin = token.githubLogin as string | undefined;
      return session;
    },
  },
};
```

- [ ] **Step 2: Create auth.ts**

```ts
// services/contextnest-mcp-host/src/lib/auth.ts
import NextAuth from 'next-auth';
import { authConfig } from './auth.config.js';

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
```

- [ ] **Step 3: Create the NextAuth route handler**

```ts
// services/contextnest-mcp-host/src/app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Create `oauth/register/route.ts` (in-memory client store)**

```ts
// services/contextnest-mcp-host/src/app/oauth/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

// In-memory client registry (clients re-register on each Claude Code startup)
const clients = new Map<string, { name: string; redirectUris: string[] }>();

export async function POST(req: NextRequest) {
  const body = await req.json() as { client_name?: string; redirect_uris?: string[] };
  const { client_name, redirect_uris } = body;

  if (!client_name || !redirect_uris?.length) {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  if (redirect_uris.length > 16) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  const clientId = `mcpc_${crypto.randomBytes(16).toString('hex')}`;
  clients.set(clientId, { name: client_name, redirectUris: redirect_uris });

  return NextResponse.json({
    client_id: clientId,
    client_name,
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }, { status: 201 });
}

export function getClient(clientId: string) {
  return clients.get(clientId);
}
```

- [ ] **Step 5: Create `oauth/authorize/route.ts`**

Port from `jhs129/roadmap/src/app/oauth/authorize/route.ts`. Key difference: instead of a Prisma consent record lookup, consent is implicit (the GitHub sign-in IS the consent). Replace the consent check with:

```ts
// services/contextnest-mcp-host/src/app/oauth/authorize/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { signAuthCode } from '@/lib/oauth/jwt';
import { getClient } from '../register/route';
import { parseAuthorizeParams } from '@/lib/oauth/authorize';
import { getRequestUrl } from '@/lib/oauth/urls';

export async function GET(req: NextRequest) {
  const params = parseAuthorizeParams(req.nextUrl.searchParams);
  if ('error' in params) {
    return NextResponse.json({ error: params.error }, { status: 400 });
  }

  const client = getClient(params.clientId);
  if (!client || !client.redirectUris.includes(params.redirectUri)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    const loginUrl = new URL('/api/auth/signin', getRequestUrl(req));
    loginUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Issue a short-lived signed auth code JWT (stateless — no DB)
  const code = await signAuthCode({
    sub: session.user.email!,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    githubAccessToken: (session as { githubAccessToken?: string }).githubAccessToken ?? '',
    githubLogin: (session as { githubLogin?: string }).githubLogin ?? session.user.name ?? '',
  });

  const redirect = new URL(params.redirectUri);
  redirect.searchParams.set('code', code);
  if (params.state) redirect.searchParams.set('state', params.state);
  return NextResponse.redirect(redirect);
}
```

Note: `signAuthCode` needs to be added to `src/lib/oauth/jwt.ts` — a short-TTL (60s) JWT containing the authorization params. The payload structure:

```ts
// Add to src/lib/oauth/jwt.ts:
interface AuthCodeClaims {
  sub: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  githubAccessToken: string;
  githubLogin: string;
}

export async function signAuthCode(claims: AuthCodeClaims): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ ...claims, type: 'auth_code' })
    .setProtectedHeader({ alg: OAUTH_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${AUTH_CODE_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAuthCode(code: string): Promise<AuthCodeClaims> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(code, key);
  if (payload.type !== 'auth_code') throw new Error('invalid token type');
  return payload as unknown as AuthCodeClaims;
}
```

- [ ] **Step 6: Create `oauth/token/route.ts` (stateless — no refresh tokens)**

```ts
// services/contextnest-mcp-host/src/app/oauth/token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthCode, signAccessToken } from '@/lib/oauth/jwt';
import { verifyPkce } from '@/lib/oauth/pkce';
import { getRequestUrl } from '@/lib/oauth/urls';

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const grantType = body.get('grant_type');

  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  const code = body.get('code') as string | null;
  const codeVerifier = body.get('code_verifier') as string | null;
  const redirectUri = body.get('redirect_uri') as string | null;

  if (!code || !codeVerifier || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  let claims;
  try {
    claims = await verifyAuthCode(code);
  } catch {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  if (!await verifyPkce(claims.codeChallenge, codeVerifier)) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  if (claims.redirectUri !== redirectUri) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  const host = getRequestUrl(req).host;
  const accessToken = await signAccessToken({
    sub: claims.sub,
    clientId: claims.clientId,
    scopes: ['mcp:read', 'mcp:write'],
    audience: `https://${host}/api/mcp`,
    extra: {
      userToken: claims.githubAccessToken,
      userLogin: claims.githubLogin,
    },
  });

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 8 * 60 * 60,
      scope: 'mcp:read mcp:write',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export const OPTIONS = () => new NextResponse(null, {
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' },
});
```

- [ ] **Step 7: Create `.well-known` endpoints**

```ts
// src/app/.well-known/oauth-authorization-server/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUrl } from '@/lib/oauth/urls';

export function GET(req: NextRequest) {
  const base = getRequestUrl(req).origin;
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: ['mcp:read', 'mcp:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}
```

```ts
// src/app/.well-known/oauth-protected-resource/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUrl } from '@/lib/oauth/urls';

export function GET(req: NextRequest) {
  const base = getRequestUrl(req).origin;
  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
}
```

```ts
// src/app/.well-known/jwks.json/route.ts
import { NextResponse } from 'next/server';
import { getJwks } from '@/lib/oauth/keys';

export async function GET() {
  return NextResponse.json(await getJwks());
}
```

- [ ] **Step 8: Build check**

```bash
cd services/contextnest-mcp-host && pnpm build
```

Expected: build succeeds with no TypeScript errors. Fix any type errors before continuing.

- [ ] **Step 9: Commit**

```bash
git add services/contextnest-mcp-host/src/
git commit -m "feat: add NextAuth GitHub provider and stateless OAuth 2.1 endpoints"
```

---

## Task 10: MCP auth middleware (verifyMcpToken)

**Files:**
- Create: `services/contextnest-mcp-host/src/lib/mcp/auth.ts`
- Test: `services/contextnest-mcp-host/src/lib/mcp/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/contextnest-mcp-host/src/lib/mcp/auth.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/oauth/keys', () => ({
  getPublicKey: vi.fn(),
}));
vi.mock('@/lib/oauth/urls', () => ({
  getRequestUrl: vi.fn(() => new URL('https://example.com/api/mcp')),
}));

describe('verifyMcpToken', () => {
  it('returns AuthInfo with userToken and userLogin from valid JWT claims', async () => {
    const { SignJWT, importPKCS8, generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');

    const { getPublicKey } = await import('@/lib/oauth/keys');
    vi.mocked(getPublicKey).mockResolvedValue(publicKey);

    const token = await new SignJWT({
      sub: 'user-123',
      client_id: 'mcpc_abc',
      scope: 'mcp:read mcp:write',
      extra: { userToken: 'ghp_abc', userLogin: 'testuser' },
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setAudience('https://example.com/api/mcp')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(privateKey);

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');
    expect(result.extra).toMatchObject({ userToken: 'ghp_abc', userLogin: 'testuser' });
    expect(result.clientId).toBe('mcpc_abc');
  });

  it('throws on expired token', async () => {
    const { generateKeyPair, SignJWT } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const { getPublicKey } = await import('@/lib/oauth/keys');
    vi.mocked(getPublicKey).mockResolvedValue(publicKey);

    const token = await new SignJWT({ sub: 'u', client_id: 'c', scope: 's', extra: {} })
      .setProtectedHeader({ alg: 'RS256' })
      .setAudience('https://example.com/api/mcp')
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(privateKey);

    const { verifyMcpToken } = await import('./auth.js');
    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/contextnest-mcp-host && pnpm test
```

- [ ] **Step 3: Create auth.ts**

```ts
// services/contextnest-mcp-host/src/lib/mcp/auth.ts
import { jwtVerify } from 'jose';
import type { AuthInfo } from 'mcp-handler';
import { getPublicKey } from '@/lib/oauth/keys';

export interface McpExtra {
  userToken: string;   // GitHub OAuth access token
  userLogin: string;   // GitHub username
}

export async function verifyMcpToken(
  token: string,
  resourceUrl: string
): Promise<AuthInfo> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, {
    audience: resourceUrl,
    algorithms: ['RS256'],
  });

  const extra = payload.extra as McpExtra;
  return {
    token,
    clientId: payload.client_id as string,
    scopes: ((payload.scope as string) ?? '').split(' ').filter(Boolean),
    extra,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/contextnest-mcp-host && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add services/contextnest-mcp-host/src/lib/mcp/auth.ts services/contextnest-mcp-host/src/lib/mcp/auth.test.ts
git commit -m "feat: add MCP bearer token verifier (RS256 JWT)"
```

---

## Task 11: MCP tool registration

Register all 22 Context Nest tools. Each tool extracts the user token from `extra`, creates an engine, calls the engine method, and returns the result. Write tools also call `sync.commitFile` / `sync.deleteFile` after a successful engine write.

**Files:**
- Create: `services/contextnest-mcp-host/src/lib/mcp/tools.ts`
- Test: `services/contextnest-mcp-host/src/lib/mcp/tools.test.ts`

- [ ] **Step 1: Write failing tests for a representative read tool and a write tool**

```ts
// services/contextnest-mcp-host/src/lib/mcp/tools.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockEngine = {
  storage: {
    readDocument: vi.fn(),
    writeDocument: vi.fn(),
    deleteDocument: vi.fn(),
    discoverDocuments: vi.fn(),
    readConfig: vi.fn(),
  },
  sync: {
    commitFile: vi.fn(),
    deleteFile: vi.fn(),
  },
  userToken: 'ghp_test',
};

vi.mock('@/lib/vault/index.js', () => ({
  createEngine: vi.fn(() => mockEngine),
}));

describe('MCP tool: get_document', () => {
  it('calls storage.readDocument and returns content', async () => {
    mockEngine.storage.readDocument.mockResolvedValue({ id: 'my-doc', body: '# Hello', frontmatter: {} });
    const { registerTools } = await import('./tools.js');
    const server = { tool: vi.fn() };
    registerTools(server as never);

    const getDocHandler = server.tool.mock.calls.find(c => c[0] === 'get_document')?.[2];
    const result = await getDocHandler({ id: 'my-doc' }, { authInfo: { extra: { userToken: 'ghp_test', userLogin: 'user' } } });
    expect(mockEngine.storage.readDocument).toHaveBeenCalledWith('my-doc');
    expect(result.content[0].text).toContain('Hello');
  });
});

describe('MCP tool: create_document', () => {
  it('calls storage.writeDocument then sync.commitFile', async () => {
    mockEngine.storage.writeDocument.mockResolvedValue(undefined);
    const { registerTools } = await import('./tools.js');
    const server = { tool: vi.fn() };
    registerTools(server as never);

    const createHandler = server.tool.mock.calls.find(c => c[0] === 'create_document')?.[2];
    await createHandler(
      { id: 'new-doc', content: '# New', type: 'node' },
      { authInfo: { extra: { userToken: 'ghp_test', userLogin: 'user' } } }
    );
    expect(mockEngine.storage.writeDocument).toHaveBeenCalled();
    expect(mockEngine.sync.commitFile).toHaveBeenCalledWith(expect.objectContaining({
      userToken: 'ghp_test',
    }));
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/contextnest-mcp-host && pnpm test
```

- [ ] **Step 3: Create tools.ts**

Read `vendor/packages/mcp-server/src/index.ts` to see the exact tool schemas and engine calls, then implement `registerTools`:

```ts
// services/contextnest-mcp-host/src/lib/mcp/tools.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createEngine } from '@/lib/vault/index';
import type { McpExtra } from './auth';

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function extra(authExtra: unknown): McpExtra {
  return authExtra as McpExtra;
}

export function registerTools(server: McpServer) {
  // ── Read tools ──────────────────────────────────────────────────────────────

  server.tool('get_document', 'Read a document from the vault by ID',
    { id: z.string() },
    async (args, ctx) => {
      const { storage, userToken } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const doc = await storage.readDocument(args.id);
      return jsonResult(doc);
    }
  );

  server.tool('list_documents', 'List all documents in the vault',
    {},
    async (_args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const docs = await storage.discoverDocuments();
      return jsonResult(docs);
    }
  );

  server.tool('resolve', 'Resolve a Context Nest selector query',
    { selector: z.string(), hops: z.number().optional(), full: z.boolean().optional() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const { GraphQueryEngine } = await import('@promptowl/contextnest-engine');
      const engine = new GraphQueryEngine(storage);
      const result = await engine.query(args.selector, { hops: args.hops, full: args.full });
      return jsonResult(result);
    }
  );

  server.tool('search', 'Full-text search across vault documents',
    { query: z.string() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const { GraphQueryEngine } = await import('@promptowl/contextnest-engine');
      const engine = new GraphQueryEngine(storage);
      const result = await engine.search(args.query);
      return jsonResult(result);
    }
  );

  server.tool('read_index', 'Return the vault context index (context.yaml)',
    {},
    async (_args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const index = await storage.readContextYaml();
      return jsonResult(index);
    }
  );

  server.tool('read_pack', 'Return a named context pack',
    { name: z.string() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const packs = await storage.readPacks();
      const pack = packs.find(p => p.name === args.name);
      return jsonResult(pack ?? null);
    }
  );

  server.tool('read_version', 'Return a specific version of a document',
    { id: z.string(), version: z.number() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const content = await storage.readKeyframe(args.id, args.version);
      return jsonResult({ id: args.id, version: args.version, content });
    }
  );

  server.tool('list_checkpoints', 'List checkpoint history for the vault',
    {},
    async (_args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const history = await storage.readCheckpointHistory();
      return jsonResult(history);
    }
  );

  server.tool('list_suggestions', 'List pending drift suggestions',
    { id: z.string() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const ids = await storage.listSuggestionIds(args.id);
      return jsonResult(ids);
    }
  );

  server.tool('get_ui_context', 'Return vault config and active context summary for AI session priming',
    {},
    async (_args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const [config, contextMd] = await Promise.all([storage.readConfig(), storage.readContextMd()]);
      return jsonResult({ config, contextMd });
    }
  );

  server.tool('document_format', 'Return the Context Nest document schema and validation rules',
    {},
    async () => {
      const { getDocumentFormat } = await import('@promptowl/contextnest-engine');
      return jsonResult(getDocumentFormat());
    }
  );

  server.tool('verify_integrity', 'Verify vault document chain integrity',
    {},
    async (_args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const report = await storage.verifyVaultIntegrity();
      return jsonResult(report);
    }
  );

  // ── Write tools ─────────────────────────────────────────────────────────────

  server.tool('create_document', 'Create a new document in the vault',
    {
      id: z.string(),
      content: z.string(),
      type: z.enum(['node', 'source']).optional(),
    },
    async (args, ctx) => {
      const mcpExtra = extra(ctx.authInfo?.extra);
      const { storage, sync } = createEngine(mcpExtra.userToken);
      await storage.writeDocument(args.id, args.content);
      sync.commitFile({
        path: `nodes/${args.id}.md`,
        content: Buffer.from(args.content, 'utf-8'),
        message: `create ${args.id}`,
        userToken: mcpExtra.userToken,
      }).catch(console.error);
      return jsonResult({ ok: true, id: args.id });
    }
  );

  server.tool('update_document', 'Update an existing document in the vault',
    { id: z.string(), content: z.string() },
    async (args, ctx) => {
      const mcpExtra = extra(ctx.authInfo?.extra);
      const { storage, sync } = createEngine(mcpExtra.userToken);
      await storage.writeDocument(args.id, args.content);
      sync.commitFile({
        path: `nodes/${args.id}.md`,
        content: Buffer.from(args.content, 'utf-8'),
        message: `update ${args.id}`,
        userToken: mcpExtra.userToken,
      }).catch(console.error);
      return jsonResult({ ok: true, id: args.id });
    }
  );

  server.tool('delete_document', 'Delete a document from the vault',
    { id: z.string() },
    async (args, ctx) => {
      const mcpExtra = extra(ctx.authInfo?.extra);
      const { storage, sync } = createEngine(mcpExtra.userToken);
      await storage.deleteDocument(args.id);
      sync.deleteFile({
        path: `nodes/${args.id}.md`,
        message: `delete ${args.id}`,
        userToken: mcpExtra.userToken,
      }).catch(console.error);
      return jsonResult({ ok: true, id: args.id });
    }
  );

  server.tool('publish_document', 'Publish (approve) a document draft',
    { id: z.string() },
    async (args, ctx) => {
      const mcpExtra = extra(ctx.authInfo?.extra);
      const { storage, sync } = createEngine(mcpExtra.userToken);
      const content = await storage.publishDocument(args.id);
      sync.commitFile({
        path: `nodes/${args.id}.md`,
        content: Buffer.from(content, 'utf-8'),
        message: `publish ${args.id}`,
        userToken: mcpExtra.userToken,
      }).catch(console.error);
      return jsonResult({ ok: true, id: args.id });
    }
  );

  server.tool('create_version', 'Create a new version keyframe for a document',
    { id: z.string() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const version = await storage.createVersion(args.id);
      return jsonResult({ ok: true, id: args.id, version });
    }
  );

  server.tool('discard_drafts', 'Discard all draft changes for a document',
    { id: z.string() },
    async (args, ctx) => {
      const mcpExtra = extra(ctx.authInfo?.extra);
      const { storage, sync } = createEngine(mcpExtra.userToken);
      await storage.discardDraft(args.id);
      sync.commitFile({
        path: `nodes/${args.id}.md`,
        content: Buffer.from('', 'utf-8'),
        message: `discard drafts ${args.id}`,
        userToken: mcpExtra.userToken,
      }).catch(console.error);
      return jsonResult({ ok: true, id: args.id });
    }
  );

  server.tool('stage_drift_suggestion', 'Stage an out-of-band edit as a suggestion for review',
    { id: z.string() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      const suggestion = await storage.stageDriftSuggestion(args.id);
      return jsonResult(suggestion);
    }
  );

  server.tool('approve_suggestion', 'Approve a pending suggestion',
    { id: z.string(), suggestionId: z.string() },
    async (args, ctx) => {
      const mcpExtra = extra(ctx.authInfo?.extra);
      const { storage, sync } = createEngine(mcpExtra.userToken);
      const content = await storage.approveSuggestion(args.id, args.suggestionId);
      sync.commitFile({
        path: `nodes/${args.id}.md`,
        content: Buffer.from(content, 'utf-8'),
        message: `approve suggestion ${args.suggestionId} on ${args.id}`,
        userToken: mcpExtra.userToken,
      }).catch(console.error);
      return jsonResult({ ok: true });
    }
  );

  server.tool('reject_suggestion', 'Reject a pending suggestion',
    { id: z.string(), suggestionId: z.string() },
    async (args, ctx) => {
      const { storage } = createEngine(extra(ctx.authInfo?.extra).userToken);
      await storage.rejectSuggestion(args.id, args.suggestionId);
      return jsonResult({ ok: true });
    }
  );
}
```

**Important:** The exact method names on `NestStorage` (e.g. `publishDocument`, `createVersion`, `discardDraft`, `stageDriftSuggestion`, `approveSuggestion`, `rejectSuggestion`) must be verified against `vendor/packages/engine/src/storage.ts` before coding. Cross-reference the vendor MCP server (`vendor/packages/mcp-server/src/index.ts`) to confirm each method name and signature. Adjust any mismatches.

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/contextnest-mcp-host && pnpm test
```

- [ ] **Step 5: Build check**

```bash
pnpm build
```

Expected: clean build. Fix any type errors.

- [ ] **Step 6: Commit**

```bash
git add services/contextnest-mcp-host/src/lib/mcp/tools.ts services/contextnest-mcp-host/src/lib/mcp/tools.test.ts
git commit -m "feat: register all 22 Context Nest MCP tools"
```

---

## Task 12: MCP route + .env.example

**Files:**
- Create: `services/contextnest-mcp-host/src/app/api/mcp/route.ts`
- Modify: `services/contextnest-mcp-host/.env.example`

- [ ] **Step 1: Create the MCP route**

```ts
// services/contextnest-mcp-host/src/app/api/mcp/route.ts
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';
import { getRequestUrl } from '@/lib/oauth/urls';
import { NextRequest } from 'next/server';

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {},
  { basePath: '/api', maxDuration: 60 }
);

const authHandler = withMcpAuth(
  handler,
  async (token, req: NextRequest) => {
    const resourceUrl = `${getRequestUrl(req).origin}/api/mcp`;
    return verifyMcpToken(token, resourceUrl);
  },
  { required: true }
);

export const GET = authHandler;
export const POST = authHandler;
export const DELETE = authHandler;
```

- [ ] **Step 2: Update .env.example**

The `.env.example` already exists at `services/contextnest-mcp-host/.env.example`. Verify it contains all variables from Section 7 of the spec. It should look like:

```bash
# Storage backend: "blob" (Vercel, default) or "fs" (local dev)
CONTEXTNEST_STORAGE=blob

# Local-only vault directory when CONTEXTNEST_STORAGE=fs
# CONTEXTNEST_VAULT_PATH=./.vault

# Vercel Blob key prefix for vault files
CONTEXTNEST_BLOB_PREFIX=vault

# Vercel Blob store token (set automatically when a Blob store is linked)
BLOB_READ_WRITE_TOKEN=

# Git vault sync provider: "github" (default)
VAULT_SYNC_PROVIDER=github

# owner/repo of the vault repository
VAULT_REPO=

# Vault branch to commit to (default: main)
# VAULT_BRANCH=main

# GitHub OAuth App
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# NextAuth secret — generate with: openssl rand -base64 32
AUTH_SECRET=

# Local dev only
NEXTAUTH_URL=http://localhost:3000

# RS256 keypair — generate with: pnpm oauth:gen-keypair
OAUTH_JWT_PRIVATE_KEY=
OAUTH_JWT_PUBLIC_KEY=
```

- [ ] **Step 3: Final build**

```bash
cd services/contextnest-mcp-host && pnpm build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add services/contextnest-mcp-host/src/app/api/mcp/ services/contextnest-mcp-host/.env.example
git commit -m "feat: wire up /api/mcp route with OAuth auth middleware"
```

---

## Task 13: Vault init script

**Files:**
- Modify: `scripts/init-vault.sh`

- [ ] **Step 1: Write the init script**

Replace the existing `scripts/init-vault.sh` stub with:

```bash
#!/usr/bin/env bash
# init-vault.sh — Push a local Context Nest vault directory to a remote git repo.
#
# Usage:
#   scripts/init-vault.sh <local-vault-path> <remote-url>
#   VAULT_REPO_URL=https://github.com/owner/repo.git scripts/init-vault.sh <local-vault-path>
#
# Requirements: git, network access. Safe to re-run (each step is guarded).

set -euo pipefail

VAULT_PATH="${1:?Usage: init-vault.sh <local-vault-path> [remote-url]}"
REMOTE_URL="${2:-${VAULT_REPO_URL:?Provide remote URL as \$2 or VAULT_REPO_URL env var}}"

echo "==> Vault path: ${VAULT_PATH}"
echo "==> Remote URL: ${REMOTE_URL}"

cd "${VAULT_PATH}"

echo "==> 1/3 Initializing git repo (if needed)"
if [ ! -d ".git" ]; then
  git init
  git add -A
  git commit -m "chore: initial vault commit"
  echo "    Initialized."
else
  echo "    Already a git repo, skipping init."
fi

echo "==> 2/3 Wiring remote origin"
if git remote get-url origin >/dev/null 2>&1; then
  echo "    Remote 'origin' already set: $(git remote get-url origin)"
else
  git remote add origin "${REMOTE_URL}"
  echo "    Added origin."
fi

echo "==> 3/3 Pushing to remote"
git push -u origin HEAD:main

echo
echo "Done. Vault pushed to ${REMOTE_URL}."
echo "Next steps:"
echo "  1. Add team members as collaborators on the Git host."
echo "  2. Link a Vercel Blob store to your Vercel project."
echo "  3. Run: vercel env add VAULT_REPO (set to owner/repo)"
echo "  4. Deploy: vercel deploy"
```

- [ ] **Step 2: Make executable and test dry-run**

```bash
chmod +x scripts/init-vault.sh
# Dry-run: point at a tmp dir to verify arg handling
TMPDIR=$(mktemp -d)
echo "# test vault" > "$TMPDIR/CONTEXT.md"
# Should fail gracefully because no remote is configured — that's expected
scripts/init-vault.sh "$TMPDIR" "https://example.com/fake.git" 2>&1 | head -10
```

Expected: prints the step messages, then fails at push (no real remote) — that's correct behavior.

- [ ] **Step 3: Commit**

```bash
git add scripts/init-vault.sh
git commit -m "feat: add vault init script (provider-agnostic, no hardcoded values)"
```

---

## Task 14: End-to-end smoke test + deploy verification

Run the app locally against a real local vault to verify the full flow before deploying.

- [ ] **Step 1: Set up a local `.env.local`**

```bash
cd services/contextnest-mcp-host
cp .env.example .env.local
```

Fill in:
- `CONTEXTNEST_STORAGE=fs`
- `CONTEXTNEST_VAULT_PATH=../../fixtures/minimal-vault` (uses the vendor fixture vault)
- `AUTH_SECRET=<openssl rand -base64 32>`
- `NEXTAUTH_URL=http://localhost:3000`
- `OAUTH_JWT_PRIVATE_KEY` / `OAUTH_JWT_PUBLIC_KEY` from `pnpm oauth:gen-keypair`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` from a test GitHub OAuth App (callback: `http://localhost:3000/api/auth/callback/github`)

- [ ] **Step 2: Start dev server**

```bash
cd services/contextnest-mcp-host && pnpm dev
```

Expected: server starts on `http://localhost:3000`.

- [ ] **Step 3: Verify .well-known endpoints respond**

```bash
curl http://localhost:3000/.well-known/oauth-authorization-server | jq .
curl http://localhost:3000/.well-known/oauth-protected-resource | jq .
curl http://localhost:3000/.well-known/jwks.json | jq .
```

Expected: JSON responses with correct URLs.

- [ ] **Step 4: Run the OAuth flow test script (from roadmap)**

Copy `jhs129/roadmap/scripts/oauth-flow-test.ts` and adapt the base URL to `http://localhost:3000`. Run:

```bash
cd services/contextnest-mcp-host && pnpm tsx scripts/oauth-flow-test.ts
```

Expected: completes the full OAuth flow (register → authorize → token) and prints a valid access token.

- [ ] **Step 5: Connect Claude Code to the local MCP server**

```bash
claude mcp add --transport http contextnest-local http://localhost:3000/api/mcp
```

Sign in when prompted. Run `/mcp` in Claude Code and verify the Context Nest tools appear.

- [ ] **Step 6: Smoke test — list and read documents**

In Claude Code with the local MCP connected:
> "Use the contextnest-local MCP to list all documents in the vault, then read one."

Expected: returns a list of documents from `fixtures/minimal-vault/nodes/`.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete Service 1 implementation — hosted CN MCP on Vercel"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Section 1 — StorageProvider interface + FsStorageProvider: Task 2
- [x] Section 1 — BlobStorageProvider: Task 3
- [x] Section 1 — StorageFactory: Task 3
- [x] Section 1 — NestStorage refactor: Task 4
- [x] Section 2 — GitVaultSyncProvider interface + factory: Task 5
- [x] Section 2 — GitHubVaultSyncProvider: Task 6
- [x] Section 3 — createEngine(): Task 7
- [x] Section 4 — OAuth 2.1 infrastructure: Tasks 8–9
- [x] Section 4 — MCP auth middleware: Task 10
- [x] Section 5 — All 22 tools registered: Task 11
- [x] Section 6 — init-vault.sh: Task 13
- [x] Section 7 — .env.example: Task 12
- [x] Section 8 — Error handling: covered in Task 6 (fire-and-forget sync) and Task 10 (401 on bad token)
- [x] Section 9 — Testing: unit tests in Tasks 2, 3, 5, 6, 7, 10, 11; integration test in Task 14

**Notable decisions documented in this plan:**
- No database / no refresh tokens in MVP. Access token TTL is 8 hours. Auth codes are stateless JWTs. Client registrations are in-memory.
- `NestStorage` constructor overloaded to accept `string | StorageProvider` — all existing `new NestStorage(root)` call sites continue to work without changes.
- `BlobStorageProvider` and all sync code live in `src/` only, never in vendor.
- Tool path convention (`nodes/{id}.md`) must be verified against the actual `NestStorage` method signatures in the vendor before implementation.
