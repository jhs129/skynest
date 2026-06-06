# Skynest Service 1 — Hosted Context Nest MCP Host: Design Spec

**Date:** 2026-06-06
**Status:** Approved
**Scope:** Service 1 only (MCP host + GitHub OAuth + Vercel Blob vault). Service 2 (read.ai webhook ingest) is a follow-on spec.

---

## Problem

John's Context Nest vault runs locally on his Mac over stdio, synced to the team via OneDrive. This has no always-on story, no remote access, no per-user attribution, and falls apart the moment his Mac is offline. The goal is a Vercel-hosted MCP server that any team member can connect to from Claude Code with their GitHub account — always available, version-controlled, with every write attributed to the person who made it.

---

## Constraints

- **No persistent filesystem on Vercel.** The upstream `PromptOwl/ContextNest` engine writes to a local vault directory. Vercel Functions have only an ephemeral per-invocation `/tmp` with no shared state across instances.
- **AGPL-3.0.** The engine is AGPL-licensed. Hosting it means our fork's modifications must be publicly available, or covered by a commercial license from PromptOwl.
- **No binary spawn.** The `contextnest-mcp` stdio binary cannot be spawned from a Vercel Function. We must import the engine as a library.

---

## Approach

Fork `PromptOwl/ContextNest` → `jhs129/ContextNest` (vendored in this repo at `services/contextnest-mcp-host/vendor/` via `git subtree`). Adapt the engine's storage layer with a **Storage Provider / Factory** abstraction so the same engine logic runs on Vercel. Production storage is **Vercel Blob**. Version history and per-user attribution are handled by the **GitHub REST API** committing to `jhs129/contextnest-vault`. The MCP server is a **Next.js App Router** app using `mcp-handler`, with **GitHub OAuth 2.1** ported from `jhs129/roadmap`.

---

## Repo Layout

```
services/contextnest-mcp-host/
  vendor/                                   # ContextNest fork (git subtree, PromptOwl/ContextNest main)
    packages/engine/src/                    # engine source — storage refactor lands here
    packages/mcp-server/                    # reference only; not used at runtime
    packages/cli/                           # reference only; not used at runtime
  src/                                      # Next.js App Router (all new code)
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
        blob.ts
        github.ts
        index.ts
  package.json
  tsconfig.json
  .env.example
scripts/
  init-vault.sh                             # one-time: local vault dir → jhs129/contextnest-vault
  setup-fork.sh                             # already run; sets up git subtree
```

---

## Section 1 — Storage Layer Refactor (vendor changes)

### Current state

`vendor/packages/engine/src/storage.ts` exports `NestStorage`, a class that calls `node:fs` directly. It is instantiated once and shared by `GraphQueryEngine`, `PackLoader`, `VersionManager`, and `CheckpointManager`. Secondary fs writers exist in `checkpoint.ts`, `index-generator.ts`, and `index-md-generator.ts` — these must also route through the provider.

### Target structure

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

Paths are always vault-relative (e.g. `nodes/my-doc.md`, `.context/config.yaml`). The provider is responsible for translating to absolute filesystem paths or Blob keys.

### StorageFactory

`createStorageProvider(config: { backend: 'fs' | 'blob'; vaultPath?: string })` returns the correct implementation. Selected by `CONTEXTNEST_STORAGE` env var at runtime — `'fs'` is the default for local dev and upstream compatibility, `'blob'` for Vercel.

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

Uses `@vercel/blob` client (`BLOB_READ_WRITE_TOKEN`). Key scheme: `{vaultPrefix}/{vault-relative-path}` where `vaultPrefix` defaults to `vault` (configurable via `CONTEXTNEST_BLOB_PREFIX`). `list(prefix)` uses Vercel Blob's `list({ prefix })` API. `read` returns `null` on a 404. All operations are async network calls — no in-memory caching at the provider level. Because each MCP tool call creates a fresh engine instance (via `createEngine`) and the instance is discarded after the call, there is no stale in-process cache to worry about across concurrent requests. If read performance becomes a bottleneck, a Vercel Edge Config or short-TTL KV cache can be added above the provider without changing the interface.

---

## Section 2 — GitHub Vault Sync

`src/lib/vault/github.ts` exports `GitHubVaultSync`.

**Responsibility:** after a successful Blob write, record the change as a GitHub commit on `jhs129/contextnest-vault` using the session user's OAuth token. This is what gives the vault its version history and per-user attribution.

**API call:** `PUT /repos/{owner}/{repo}/contents/{path}` — creates or updates a file, requires the current file SHA for updates. The class maintains an in-memory SHA cache per session (populated lazily on first write to a given path; invalidated on delete).

**Attribution:** the GitHub API commit is made with the user's own token, so GitHub natively attributes the commit to their account — no `--author` flag needed.

**Error handling:** GitHub sync failures are logged but do not fail the MCP tool call. The Blob write is the authoritative operation; GitHub is the version history layer. A background reconciliation mechanism (future work) can detect and replay missed commits.

**Write serialization:** a per-session async queue (a simple Promise chain) ensures writes for a given session are serialized. Concurrent writes from different sessions are naturally independent (different tokens, different commit sequences).

---

## Section 3 — Engine Factory

`src/lib/vault/index.ts` exports `createEngine(userToken: string): NestEngine`.

Constructs a `BlobStorageProvider` (or `FsStorageProvider` in dev), wraps it in `NestStorage`, attaches a `GitHubVaultSync` instance for the given user token, and returns a fully configured engine instance. Each MCP tool call creates one engine instance — stateless across requests, correct attribution per call.

---

## Section 4 — Next.js App & MCP Layer

### MCP route (`src/app/api/mcp/route.ts`)

Uses `createMcpHandler` from `mcp-handler`. All Context Nest tools are registered in `src/lib/mcp/tools.ts`. Each tool handler:
1. Extracts the user's GitHub token from `extra.authInfo`.
2. Calls `createEngine(userToken)` to get a scoped engine instance.
3. Invokes the relevant engine method.
4. Returns the result as JSON.

The route is wrapped with `withMcpAuth(handler, verifyMcpToken, { required: true })`.

### Auth middleware (`src/lib/mcp/auth.ts`)

Ported from `jhs129/roadmap/src/lib/mcp/auth.ts`. Validates the RS256 JWT Bearer token, returns `AuthInfo` with `extra: { userId, githubToken, githubLogin }`. The GitHub OAuth token (with `repo` scope) is stored in the JWT's `extra` claims so tool handlers can use it for vault writes without a database round-trip.

### OAuth 2.1 server (authorize / token / register / .well-known)

Ported directly from `jhs129/roadmap` with one provider change: `auth.config.ts` uses `GitHub({ clientId, clientSecret })` from `next-auth/providers/github` instead of `Google`. The `repo` scope is requested so the user's token can push to `contextnest-vault`. Everything else (PKCE, RS256 JWT issuance, dynamic client registration, refresh token rotation, `.well-known` metadata endpoints) is identical to roadmap.

---

## Section 5 — Tool Registration

All Context Nest tools are registered in `src/lib/mcp/tools.ts`. They map 1:1 to the engine's existing method surface — no tool logic is reimplemented. The full list from `vendor/packages/mcp-server/src/index.ts` is:

**Read tools** (Blob only, no GitHub sync):
`resolve`, `search`, `get_document`, `list_documents`, `read_index`, `read_pack`, `read_version`, `list_checkpoints`, `list_suggestions`, `get_ui_context` (returns the current vault config + active context summary used to prime an AI session)

**Write tools** (Blob write + GitHub sync):
`create_document`, `update_document`, `delete_document`, `publish_document`, `create_version`, `discard_drafts`, `approve_suggestion`, `reject_suggestion`, `stage_drift_suggestion`

**Stateless utility tools** (no storage):
`document_format`, `verify_integrity`

Tool input schemas are copied from the upstream MCP server package and validated with `zod` in each handler before calling the engine.

---

## Section 6 — Vault Init Script

`scripts/init-vault.sh` is a one-time setup script:
1. Takes a local vault directory path as `$1`.
2. `git init` + initial commit if not already a git repo.
3. `gh repo create jhs129/contextnest-vault --private` (skips if repo exists).
4. `git remote add origin` + `git push -u origin main`.
5. Prints next steps (add team collaborators, link Blob store, run Vercel deploy).

Requires: `gh` CLI (authenticated), `git`. Safe to re-run (each step is guarded).

---

## Section 7 — Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CONTEXTNEST_STORAGE` | No | `blob` (default on Vercel) or `fs` (local dev) |
| `CONTEXTNEST_VAULT_PATH` | Dev only | Local vault dir when `CONTEXTNEST_STORAGE=fs` |
| `BLOB_READ_WRITE_TOKEN` | Prod | Vercel Blob store token (auto-provided when store is linked) |
| `CONTEXTNEST_VAULT_REPO` | Yes | `owner/repo` of the GitHub vault (e.g. `jhs129/contextnest-vault`) |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `AUTH_SECRET` | Yes | NextAuth secret (random 32-byte string) |
| `NEXTAUTH_URL` | Dev only | `http://localhost:3000` |
| `OAUTH_JWT_PRIVATE_KEY` | Yes | RS256 private key for MCP access token signing (generate with `scripts/oauth-gen-keypair.ts` from roadmap) |
| `OAUTH_JWT_PUBLIC_KEY` | Yes | Corresponding RS256 public key |

---

## Section 8 — Error Handling

- **Blob not found:** `read()` returns `null`; engine surfaces as a "document not found" MCP error.
- **GitHub sync failure:** logged to Vercel function logs; MCP tool call still succeeds. SHA cache is invalidated for the affected path so the next write re-fetches the current SHA.
- **Invalid/expired MCP token:** `withMcpAuth` returns HTTP 401; Claude Code re-initiates OAuth flow.
- **GitHub API rate limit (5000 req/hr for authenticated user):** at current usage (~20 team members, low write frequency) this is not a concern. Log `X-RateLimit-Remaining` headers; add exponential backoff retry on 429 in `GitHubVaultSync`.
- **Concurrent writes (same user, same session):** serialized by per-session async queue in `GitHubVaultSync`. Different sessions are independent.

---

## Section 9 — Testing

**Unit (vendor engine):**
- `FsStorageProvider` — existing upstream tests continue to pass against a tmp dir.
- `BlobStorageProvider` — tested with `@vercel/blob` mock (jest mock or MSW).
- `NestStorage` — existing tests adapted to inject a `FsStorageProvider`.

**Unit (Next.js app):**
- `GitHubVaultSync` — mock `fetch`; assert correct `PUT /contents` payload and SHA cache behavior.
- `verifyMcpToken` — test valid/expired/wrong-audience JWTs.
- Each tool handler — mock `createEngine`; assert correct engine method called with correct args.

**Integration:**
- Two GitHub OAuth users each call `create_document` → assert two commits on `contextnest-vault` with distinct authors.
- Read tools return documents created in prior write calls.

**End-to-end:**
- Connect Claude Code to the Vercel-hosted MCP → OAuth sign-in → create, update, search a document → verify commit appears in `contextnest-vault` with correct GitHub author.

---

## Open Items (Service 1 only)

- **AGPL compliance:** confirm with PromptOwl whether hosting the fork with modifications satisfies AGPL by keeping the fork public (`jhs129/ContextNest`), or whether a commercial license is needed.
- **Blob prefix per-team:** if skynest later serves multiple teams from one Vercel project, `CONTEXTNEST_BLOB_PREFIX` parameterizes which namespace each deployment reads/writes.
- **SHA cache persistence:** the in-memory SHA cache is lost on function cold start. First write after cold start fetches the current SHA from GitHub — adds one extra API call. Acceptable at this scale; revisit if cold starts become frequent.

---

## Out of Scope (Service 2)

read.ai webhook ingest (`POST /webhooks/readai`, HMAC verify, MCP client → `create_document` as bot identity) is a separate service and will have its own spec.
