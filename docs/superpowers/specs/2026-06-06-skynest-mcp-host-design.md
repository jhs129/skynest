# Skynest Service 1 — Hosted Context Nest MCP Host: Design Spec

**Date:** 2026-06-06
**Status:** Approved (rev 2 — vault sync factory pattern, no hardcoded accounts, vendor scope constraint)
**Scope:** Service 1 only (MCP host + GitHub OAuth + Vercel Blob vault). Service 2 (read.ai webhook ingest) is a follow-on spec.

---

## Problem

A Context Nest vault runs locally over stdio, synced to the team via OneDrive. This has no always-on story, no remote access, no per-user attribution, and falls apart the moment the host machine is offline. The goal is a Vercel-hosted MCP server that any team member can connect to from Claude Code with their GitHub account — always available, version-controlled, with every write attributed to the person who made it.

---

## Constraints

- **No persistent filesystem on Vercel.** The upstream `PromptOwl/ContextNest` engine writes to a local vault directory. Vercel Functions have only an ephemeral per-invocation `/tmp` with no shared state across instances.
- **AGPL-3.0.** The engine is AGPL-licensed. Hosting it means our fork's modifications must be publicly available, or covered by a commercial license from PromptOwl. Because the fork must be public, **no account names, repository URLs, or deployment-specific values may be hardcoded in any file under `vendor/`** (or anywhere in this repo). All such values come from environment variables.
- **No binary spawn.** The `contextnest-mcp` stdio binary cannot be spawned from a Vercel Function. We must import the engine as a library.

---

## Approach

Fork `PromptOwl/ContextNest` (vendored in this repo at `services/contextnest-mcp-host/vendor/` via `git subtree`). Adapt the engine's storage layer with a **Storage Provider / Factory** abstraction so the same engine logic runs on Vercel. Production storage is **Vercel Blob**. Version history and per-user attribution are handled by a **Git Vault Sync** layer — itself abstracted behind a **GitVaultSyncProvider / Factory** so the backing Git host (GitHub, GitLab, etc.) is pluggable. The MCP server is a **Next.js App Router** app using `mcp-handler`, with **GitHub OAuth 2.1** ported from the reference roadmap implementation.

---

## Vendor Subtree Scope Constraint

**Changes to `vendor/` are strictly limited to the storage abstraction.** The only modifications permitted in `vendor/packages/engine/` are:

1. The new `storage/` directory (interface, factory, providers, refactored `NestStorage`).
2. Making `NestStorage`'s methods `async` and updating its four collaborators to `await` them.

No skynest application logic (Git vault sync, OAuth wiring, MCP tool registration, Vercel-specific config) belongs in the vendor tree. Those live entirely in `src/`. This keeps the vendor diff minimal, reviewable against upstream, and free of any deployment-specific or account-specific values.

---

## Repo Layout

```
services/contextnest-mcp-host/
  vendor/                                   # ContextNest fork (git subtree, PromptOwl/ContextNest main)
    packages/engine/src/storage/            # ONLY vendor change — storage abstraction
    packages/mcp-server/                    # reference only; not used at runtime
    packages/cli/                           # reference only; not used at runtime
  src/                                      # Next.js App Router (all skynest-specific code)
    app/
      api/mcp/route.ts
      oauth/authorize/route.ts
      oauth/token/route.ts
      oauth/register/route.ts
      .well-known/oauth-authorization-server/route.ts
      .well-known/oauth-protected-resource/route.ts
      .well-known/jwks.json/route.ts
    lib/
      auth.ts
      auth.config.ts
      oauth/                                # jwt, keys, pkce, tokens, config, urls
      mcp/
        auth.ts
        tools.ts
      vault/
        storage/
          blob.ts                           # BlobStorageProvider (Vercel Blob)
        sync/
          git-vault-sync-provider.ts        # GitVaultSyncProvider interface
          git-vault-sync-factory.ts         # createGitVaultSyncProvider(config)
          providers/
            github-vault-sync-provider.ts   # GitHub REST API implementation
        index.ts                            # createEngine(userToken) → configured NestEngine
  package.json
  tsconfig.json
  .env.example
scripts/
  init-vault.sh                             # one-time: local vault dir → remote git repo (provider-agnostic)
  setup-fork.sh                             # already run; sets up git subtree
```

---

## Section 1 — Storage Layer Refactor (vendor-only changes)

### Current state

`vendor/packages/engine/src/storage.ts` exports `NestStorage`, a class that calls `node:fs` directly. It is instantiated once and shared by `GraphQueryEngine`, `PackLoader`, `VersionManager`, and `CheckpointManager`. Secondary fs writers exist in `checkpoint.ts`, `index-generator.ts`, and `index-md-generator.ts` — these must also route through the provider.

### Target structure (vendor changes only)

```
vendor/packages/engine/src/storage/
  storage-provider.ts          # StorageProvider interface
  storage-factory.ts           # createStorageProvider(config) → implementation
  providers/
    fs-storage-provider.ts     # wraps node:fs/promises (dev, tests, upstream parity)
    blob-storage-provider.ts   # wraps @vercel/blob (production)
  nest-storage.ts              # NestStorage — delegates all I/O to injected StorageProvider
```

### StorageProvider interface

```ts
interface StorageProvider {
  read(path: string): Promise<Buffer | null>;   // null = not found
  write(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;      // vault-relative paths
  exists(path: string): Promise<boolean>;
}
```

Paths are always vault-relative (e.g. `nodes/my-doc.md`, `.context/config.yaml`). The provider translates to absolute filesystem paths or Blob keys.

### StorageFactory

`createStorageProvider(config: { backend: 'fs' | 'blob'; vaultPath?: string })` returns the correct implementation. Selected by `CONTEXTNEST_STORAGE` env var — `'fs'` is the default for local dev and upstream compatibility, `'blob'` for Vercel. No account or repository names appear in the factory or any provider.

### NestStorage changes

- Constructor gains `provider: StorageProvider` parameter.
- All `fs.*` calls replaced with `await this.provider.*` calls.
- All methods become `async` throughout.
- The four engine collaborators (`GraphQueryEngine`, `PackLoader`, `VersionManager`, `CheckpointManager`) are updated to `await` the now-async `NestStorage` methods. Public engine API is otherwise unchanged.

### FsStorageProvider

Thin wrapper around `node:fs/promises`. Preserves upstream behavior exactly. Used for:
- Local development (`CONTEXTNEST_STORAGE=fs`, `CONTEXTNEST_VAULT_PATH=./.vault`)
- Unit and integration tests (operating against a tmp dir)
- Upstream diff baseline — no logic changes from original `NestStorage` fs calls

### BlobStorageProvider

Uses `@vercel/blob` client (`BLOB_READ_WRITE_TOKEN`). Key scheme: `{vaultPrefix}/{vault-relative-path}` where `vaultPrefix` is read from `CONTEXTNEST_BLOB_PREFIX` (no default hardcoded). `list(prefix)` uses Vercel Blob's `list({ prefix })` API. `read` returns `null` on a 404. All operations are async network calls — no in-memory caching at the provider level. Because each MCP tool call creates a fresh engine instance (via `createEngine`) and the instance is discarded after the call, there is no stale in-process cache to worry about across concurrent requests. If read performance becomes a bottleneck, a short-TTL KV cache can be added above the provider without changing the interface.

---

## Section 2 — Git Vault Sync (src only — not in vendor)

Version history and per-user attribution are handled by a **Git Vault Sync** layer that lives entirely in `src/lib/vault/sync/`. It is abstracted behind a provider interface so the backing Git host is pluggable (GitHub today; GitLab, Gitea, or others in future deployments).

### GitVaultSyncProvider interface

```ts
interface GitVaultSyncProvider {
  /** Record a file write as a versioned commit attributed to the given user. */
  commitFile(params: {
    path: string;
    content: Buffer;
    message: string;
    userToken: string;
  }): Promise<void>;

  /** Record a file deletion as a versioned commit. */
  deleteFile(params: {
    path: string;
    message: string;
    userToken: string;
  }): Promise<void>;
}
```

The interface deliberately hides Git provider details. `userToken` is the session user's OAuth token for the chosen provider; attribution is handled inside the implementation.

### GitVaultSyncFactory

`createGitVaultSyncProvider(config: { provider: 'github' | string }): GitVaultSyncProvider`

Selected by `VAULT_SYNC_PROVIDER` env var (default `'github'`). New providers are added by implementing the interface and registering them in the factory — no changes required outside the factory file.

### GitHubVaultSyncProvider

Implements `GitVaultSyncProvider` using the GitHub REST API `PUT /repos/{owner}/{repo}/contents/{path}`. All repository coordinates come from environment variables — no account or repo names are hardcoded:

- `VAULT_REPO` — `owner/repo` (e.g. the vault repository)
- `VAULT_BRANCH` — target branch (default `main`)

**SHA management:** GitHub's Contents API requires the current file SHA for updates. The provider maintains an in-memory SHA cache per instance (populated lazily on first write; invalidated on delete). The cache is lost on cold start — the first write after a cold start fetches the current SHA via `GET /contents/{path}`, adding one extra API call. Acceptable at this scale.

**Attribution:** commits are made with the session user's own token; GitHub natively attributes the commit to their account.

**Error handling:** sync failures are logged but do not fail the MCP tool call. The Blob write is the authoritative operation; Git history is the versioning layer. The SHA cache is invalidated on failure so the next attempt re-fetches.

**Write serialization:** a per-session async queue (simple Promise chain) serializes writes within a session. Concurrent writes from different sessions are independent.

---

## Section 3 — Engine Factory (src only)

`src/lib/vault/index.ts` exports `createEngine(userToken: string): NestEngine`.

Constructs a `BlobStorageProvider` (or `FsStorageProvider` in dev via `CONTEXTNEST_STORAGE`), wraps it in `NestStorage`, and creates a `GitVaultSyncProvider` for the given user token using the factory. Returns a fully configured engine instance. Each MCP tool call creates one engine instance — stateless across requests, correct attribution per call.

---

## Section 4 — Next.js App & MCP Layer

### MCP route (`src/app/api/mcp/route.ts`)

Uses `createMcpHandler` from `mcp-handler`. All Context Nest tools are registered in `src/lib/mcp/tools.ts`. Each tool handler:
1. Extracts the user's OAuth token from `extra.authInfo`.
2. Calls `createEngine(userToken)` to get a scoped engine instance.
3. Invokes the relevant engine method.
4. Returns the result as JSON.

The route is wrapped with `withMcpAuth(handler, verifyMcpToken, { required: true })`.

### Auth middleware (`src/lib/mcp/auth.ts`)

Ported from the roadmap reference implementation. Validates the RS256 JWT Bearer token, returns `AuthInfo` with `extra: { userId, userToken, userLogin }`. The OAuth token (with `repo` scope for GitHub) is stored in the JWT's `extra` claims so tool handlers can use it for vault writes without a database round-trip.

### OAuth 2.1 server (authorize / token / register / .well-known)

Ported directly from the roadmap reference with one provider change: `auth.config.ts` uses `GitHub({ clientId, clientSecret })` from `next-auth/providers/github` instead of Google. The `repo` scope is requested so the user's token has write access to the vault repository. Everything else (PKCE, RS256 JWT issuance, dynamic client registration, refresh token rotation, `.well-known` metadata endpoints) is identical to the reference.

---

## Section 5 — Tool Registration

All Context Nest tools are registered in `src/lib/mcp/tools.ts`. They map 1:1 to the engine's existing method surface — no tool logic is reimplemented. The full list from `vendor/packages/mcp-server/src/index.ts` is:

**Read tools** (Blob only, no Git sync):
`resolve`, `search`, `get_document`, `list_documents`, `read_index`, `read_pack`, `read_version`, `list_checkpoints`, `list_suggestions`, `get_ui_context` (returns the current vault config + active context summary used to prime an AI session)

**Write tools** (Blob write + Git vault sync):
`create_document`, `update_document`, `delete_document`, `publish_document`, `create_version`, `discard_drafts`, `approve_suggestion`, `reject_suggestion`, `stage_drift_suggestion`

**Stateless utility tools** (no storage):
`document_format`, `verify_integrity`

Tool input schemas are copied from the upstream MCP server package and validated with `zod` in each handler before calling the engine.

---

## Section 6 — Vault Init Script

`scripts/init-vault.sh` is a one-time setup script. It does not hardcode any account or repository names — all values are passed as arguments or read from environment variables:

1. Takes a local vault directory path as `$1` and a target remote URL as `$2` (or reads `VAULT_REPO_URL` from the environment).
2. `git init` + initial commit if not already a git repo.
3. `git remote add origin <url>` + `git push -u origin main`.
4. Prints next steps (add collaborators on the Git host, link Vercel Blob store, run Vercel deploy).

Requires: `git`, network access. Safe to re-run (each step is guarded).

---

## Section 7 — Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CONTEXTNEST_STORAGE` | No | `blob` (default on Vercel) or `fs` (local dev) |
| `CONTEXTNEST_VAULT_PATH` | Dev only | Local vault dir when `CONTEXTNEST_STORAGE=fs` |
| `CONTEXTNEST_BLOB_PREFIX` | Yes (prod) | Vercel Blob key prefix for vault files (e.g. `vault`) |
| `BLOB_READ_WRITE_TOKEN` | Yes (prod) | Vercel Blob store token (auto-provided when store is linked) |
| `VAULT_SYNC_PROVIDER` | No | Git sync backend: `github` (default), extensible |
| `VAULT_REPO` | Yes | `owner/repo` of the vault repository on the Git host |
| `VAULT_BRANCH` | No | Vault branch to commit to (default `main`) |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `AUTH_SECRET` | Yes | NextAuth secret (random 32-byte string) |
| `NEXTAUTH_URL` | Dev only | Base URL of the app, e.g. `http://localhost:3000` |
| `OAUTH_JWT_PRIVATE_KEY` | Yes | RS256 private key for MCP access token signing |
| `OAUTH_JWT_PUBLIC_KEY` | Yes | Corresponding RS256 public key |

---

## Section 8 — Error Handling

- **Blob not found:** `read()` returns `null`; engine surfaces as a "document not found" MCP error.
- **Git sync failure:** logged to Vercel function logs; MCP tool call still succeeds. SHA cache is invalidated for the affected path so the next write re-fetches.
- **Invalid/expired MCP token:** `withMcpAuth` returns HTTP 401; Claude Code re-initiates OAuth flow.
- **Git API rate limit:** log rate-limit headers from the provider response; add exponential backoff retry on 429/503 in the provider implementation.
- **Concurrent writes (same session):** serialized by per-session async queue in `GitVaultSyncProvider`. Different sessions are independent.

---

## Section 9 — Testing

**Unit (vendor engine):**
- `FsStorageProvider` — existing upstream tests continue to pass against a tmp dir.
- `BlobStorageProvider` — tested with `@vercel/blob` mock (MSW or jest mock).
- `NestStorage` — existing tests adapted to inject a `FsStorageProvider`.

**Unit (Next.js app):**
- `GitHubVaultSyncProvider` — mock `fetch`; assert correct PUT payload and SHA cache behavior.
- `GitVaultSyncFactory` — assert correct provider is returned for each `VAULT_SYNC_PROVIDER` value.
- `verifyMcpToken` — test valid/expired/wrong-audience JWTs.
- Each tool handler — mock `createEngine`; assert correct engine method called with correct args.

**Integration:**
- Two OAuth users each call `create_document` → assert two commits on the vault repo with distinct authors.
- Read tools return documents created in prior write calls.

**End-to-end:**
- Connect Claude Code to the Vercel-hosted MCP → OAuth sign-in → create, update, search a document → verify commit appears in the vault repo with correct author attribution.

---

## Open Items (Service 1 only)

- **AGPL compliance:** confirm with PromptOwl whether hosting the fork with modifications satisfies AGPL by keeping the fork's source public, or whether a commercial license is needed. The public repo constraint (no hardcoded values) is already enforced by the vendor scope rule above.
- **Blob prefix per-team:** `CONTEXTNEST_BLOB_PREFIX` parameterizes the namespace; multiple teams can share one Vercel Blob store by using distinct prefixes.
- **SHA cache cold-start cost:** first write after a cold start fetches the current SHA from the Git provider (~1 extra API call). Acceptable at current scale; a shared KV store (e.g. Upstash Redis via Vercel Marketplace) could persist the cache across instances if needed.

---

## Out of Scope (Service 2)

read.ai webhook ingest (`POST /webhooks/readai`, HMAC verify, MCP client → `create_document` as bot identity) is a separate service and will have its own spec.
