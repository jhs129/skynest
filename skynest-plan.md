# Plan: Hosted Context Nest MCP + read.ai ingestion on Vercel (git-backed, GitHub OAuth)

> Intended home: the dedicated repo **`jhs129/skynest`** (this copy lives in `claude-jhsdc` only for transfer).

## Context

**Why:** John wants his Context Nest vault to be **always available remotely** (not tied to his Mac), **versioned/backed up in git**, **multi-user with per-user attribution**, and fed automatically by **read.ai meeting reports** — all without requiring users to understand git.

**Current state:** On John's Mac the Context Nest MCP server runs locally over **stdio**, and the vault filesystem sits on a **drive mapped to OneDrive** that syncs to his team. Works locally, but has no always-on/remote/multi-user story.

**Hard constraint:** Context Nest (the `@promptowl/contextnest-*` packages) is built around a **local persistent filesystem** — the engine reads/writes a vault directory and the MCP server runs over **stdio** with a `CONTEXTNEST_VAULT_PATH`. Vercel's serverless runtime has **no persistent, writable, shared filesystem** (only an ephemeral, per-invocation `/tmp` that is not shared across instances and is wiped between cold starts). So the upstream project cannot run unmodified on Vercel.

**Approach (revised — fork & adapt, not reimplement):** Rather than reimplementing the 14–20 tools from scratch, **fork `PromptOwl/ContextNest` → `jhs129/ContextNest`** and adapt its storage layer so the same engine/tool logic runs on Vercel. Investigation of the engine shows I/O is centralized: a single `NestStorage` class (`packages/engine/src/storage.ts`) backs `GraphQueryEngine`, `PackLoader`, `VersionManager`, and `CheckpointManager` through one shared storage instance. That seam is what we replace — refactoring it into a **Storage Provider interface selected by a Storage Factory** (see "Forking & filesystem strategy" below). The backing store is **Vercel Blob**, with the **GitHub REST API** providing versioning + per-user attribution (commits via the user's OAuth token — no `git clone`/`git push` needed). Reimplementing the tools natively is retained only as a fallback if the fork proves too costly to track upstream.

**Decisions confirmed:**
- **Deployment: Vercel** (not Azure). Next.js App Router, same stack as `jhs129/roadmap`.
- **Fork the upstream project:** Fork `github.com/PromptOwl/ContextNest` → **`jhs129/ContextNest`** and adapt it for Vercel rather than reimplementing. AGPL-3.0 obligations are met by keeping the fork's source public (or making our modifications available); commercial licensing from PromptOwl is the alternative if we need to keep changes closed.
- **Filesystem on Vercel → Vercel Blob (decided):** Solve the "no persistent local filesystem" problem by abstracting the engine's `NestStorage` into a **Storage Provider interface chosen at runtime by a Storage Factory**. The production provider is **`BlobStorageProvider`** (Vercel Blob); a **`FsStorageProvider`** preserves the original local-filesystem behavior for upstream parity, local dev, and tests. Version history/attribution = **GitHub REST API**. (The earlier `/tmp`-hydration idea is dropped in favor of the provider abstraction.)
- **Phasing: Service 1 first** (hosted MCP + GitHub OAuth + vault writes), then Service 2 (read.ai webhook ingest) as a follow-on spec/plan.
- **Writes are attributed per user** via **GitHub OAuth** — user's own token with `repo` scope is used for GitHub API commits (native attribution). No central service account push.
- **Vault storage: Vercel Blob** for file contents (individual markdown objects). **GitHub repo `jhs129/contextnest-vault`** remains the source of truth for version history; writes go through the GitHub API, not git CLI.
- **Vault init script:** A one-time `scripts/init-vault.sh` in this repo takes a local vault directory and pushes it to a new private GitHub repo.
- **OAuth: GitHub OAuth only** (no Google, no Microsoft). Port the full OAuth 2.1 implementation from `jhs129/roadmap` (authorize/token/register endpoints, RS256 JWTs, PKCE, `.well-known` metadata, `mcp-handler` middleware) and swap the provider from Google to GitHub.
- **MCP transport: Next.js + `mcp-handler`** (same as roadmap). MCP tools exposed via `/api/mcp` route with `withMcpAuth` middleware.
- **OneDrive:** demoted to optional passive backup; the hosted MCP is the access path going forward.

**Storage decision (resolved):** Vault file contents live in **Vercel Blob** (reads ~0ms, the live working copy); the **GitHub API** records every write as a commit to `contextnest-vault` (source of truth + per-user attribution). This is implemented behind a Storage Factory/Provider abstraction in the fork so the backend is swappable — see "Forking & filesystem strategy".

---

## Forking & filesystem strategy

**Step 0 — fork:** Fork `PromptOwl/ContextNest` → `jhs129/ContextNest`. Add `PromptOwl/ContextNest` as an `upstream` remote so we can pull future releases. Consume it from Service 1 either as a **git submodule** under `services/contextnest-mcp-host/vendor/contextnest`, or by publishing the patched `@promptowl/contextnest-engine` to a private package and depending on it. Submodule is preferred early (easier to iterate + diff against upstream).

**The seam:** The engine concentrates I/O in `packages/engine/src/storage.ts` (`NestStorage`), shared by `GraphQueryEngine`, `PackLoader`, `VersionManager`, and `CheckpointManager`. Today these collaborators are coupled to `NestStorage`'s direct `fs` calls. We refactor that into a **Factory / Provider pattern** so the backend is selected at runtime and all backend-specific code is isolated to a single provider implementation. Audit secondary writers too — `checkpoint.ts`, `index-generator.ts`, `index-md-generator.ts` may touch `fs` directly and must be routed through the provider rather than `fs`.

### Storage Provider / Factory design

```
packages/engine/src/storage/
  storage-provider.ts        # interface StorageProvider (the contract)
  storage-factory.ts         # createStorageProvider(config) → picks impl by env/config
  providers/
    fs-storage-provider.ts   # original local-filesystem behavior (upstream parity, dev, tests)
    blob-storage-provider.ts # Vercel Blob impl (production on Vercel)
  nest-storage.ts            # NestStorage now delegates to an injected StorageProvider
```

- **`StorageProvider` interface** — the minimal contract every backend implements. Async-only (Blob is network I/O), path-addressed by the vault-relative key the engine already uses:
  ```ts
  interface StorageProvider {
    read(path: string): Promise<Buffer | null>;   // null = not found
    write(path: string, data: Buffer): Promise<void>;
    delete(path: string): Promise<void>;
    list(prefix: string): Promise<string[]>;       // vault-relative paths
    exists(path: string): Promise<boolean>;
  }
  ```
  Making `NestStorage`'s methods async is the main upstream-divergence cost; callers (`GraphQueryEngine` et al.) are updated to `await`. We keep the public engine API otherwise identical.

- **`StorageFactory`** — `createStorageProvider(config)` returns the provider chosen by config/env, e.g. `CONTEXTNEST_STORAGE=blob|fs` (default `fs` upstream, `blob` on Vercel). This is the single switch point; no other code branches on backend type. New backends (e.g. S3 later) are added by dropping in a provider + registering it here — open/closed.

- **`NestStorage`** — keeps its current responsibilities (path resolution, frontmatter, index/hash-chain orchestration) but takes a `StorageProvider` via constructor injection and calls the interface instead of `fs`. The four engine collaborators continue to receive a single shared `NestStorage`, unchanged.

- **`FsStorageProvider`** — wraps `node:fs/promises` exactly as upstream behaves. Keeps the local CLI / `fixtures/minimal-vault` working and is the fast path for unit tests (tmp dir). Preserves AGPL upstream behavior with zero functional change.

- **`BlobStorageProvider`** — implements the interface over **Vercel Blob** (`@vercel/blob`): `put`/`head`/`del`/`list` keyed by the vault-relative path (e.g. `nodes/foo.md`). The vault's `context.yaml`/index regenerate into Blob on every mutation, same as on disk. WRITE tools additionally commit through the **GitHub REST API** (`PUT /repos/jhs129/contextnest-vault/contents/...`) using the session user's OAuth token — native per-user attribution + full version history. Fast reads (~0ms), no cold-start hydration; Blob is eventually consistent so the **GitHub repo is the source of truth**, Blob is the live working copy.

This keeps every backend difference inside `providers/` behind one interface and one factory — the engine, tools, and the rest of the fork stay backend-agnostic, which also minimizes merge conflicts when pulling from `upstream`.

**Why Vercel Blob:** Vercel serverless functions are stateless and only `/tmp` is writable (ephemeral, ~512MB, per-instance, wiped between cold starts) — durable state must go to a managed store. **Vercel Blob** is the recommended fit for opaque file/markdown objects, which is exactly what a vault node is. Alternatives considered and rejected: a network filesystem/EFS-style mount (not offered by Vercel), S3/R2 (works, but adds a second vendor when Blob already covers it — and the provider pattern lets us add it later if needed), or a database/KV (poor fit for whole-markdown-file semantics and git diffing). Blob + GitHub API stays closest to Context Nest's file-per-node model.

**Transport note:** the upstream MCP server speaks **stdio**; on Vercel we don't run that process. Service 1 keeps its own `/api/mcp` route (`mcp-handler` + GitHub OAuth) and calls the **forked engine as a library** (import `GraphQueryEngine`/`NestStorage`, constructed with the Blob provider via the factory), so we reuse tool *logic* without the stdio process or a vault path on disk.

---

## Architecture (updated)

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │ Service 1 — Hosted Context Nest MCP server (Vercel / Next.js)         │
   │   • Next.js App Router, mcp-handler, /api/mcp route                   │
   │   • GitHub OAuth 2.1 (ported from jhs129/roadmap)                     │
   │   • Forked engine (jhs129/ContextNest) used as a library              │
   │     — NestStorage → StorageProvider iface; Factory picks BlobProvider  │
   │   • Vault files: Vercel Blob (read/write) + GitHub API (commit/history)│
   │   • WRITE tools → Vercel Blob put → GitHub API PUT /contents           │
   │                    (commit attributed to session user's GitHub token)   │
   └───────▲───────────────────────▲───────────────────────────┬───────────┘
           │ MCP (GitHub OAuth)     │ MCP (service identity)    │ GitHub API
           │                        │                           ▼
   John's Claude Code      ┌────────┴───────────────┐   ┌───────────────────┐
   + 20-person team        │ Service 2 — read.ai    │   │ Private git repo  │
   (each their own         │ webhook (Vercel, TBD)  │   │ jhs129/           │
    GitHub account →       │  • POST /webhooks/readai│  │ contextnest-vault │ ◀ SOURCE OF TRUTH
    attributed commits)    │  • HMAC + request_id    │  │ (team = collabs)  │
                           │  • transform payload    │  └───────────────────┘
   read.ai ──webhook────▶  │  • MCP client → create_ │
   (meeting_end)           │    document (bot id)    │
                           └─────────────────────────┘
```

### Service 1 — Hosted Context Nest MCP server
- **Next.js App Router** deployed on Vercel, using `mcp-handler` for the `/api/mcp` route.
- **Tool layer:** the **forked `jhs129/ContextNest` engine** imported as a library (submodule or private package), exposing its existing tool/engine logic through the `/api/mcp` route. No stdio process, no vault path on disk. The engine's `NestStorage` delegates to a **`StorageProvider`** selected by the **Storage Factory**; on Vercel the factory returns the **`BlobStorageProvider`**. Tool surface (upstream exposes ~18–20):
  - **Read:** `vault_info`, `resolve`, `read_document`, `list_documents`, `search`, `verify_integrity`, `read_index`, `read_pack`, `read_version` — served from Vercel Blob via the storage adapter.
  - **Write:** `create_document`, `update_document`, `delete_document`, `publish_document` — write through the storage adapter to Vercel Blob, then commit via GitHub API with user attribution.
- **Auth:** GitHub OAuth 2.1, ported from `jhs129/roadmap`. Full PKCE + dynamic client registration + RS256 JWTs. The GitHub access token (with `repo` scope) is stored in the session and used for GitHub API write calls.
- **Vault storage:** Vercel Blob stores vault files as markdown objects (key = relative vault path). GitHub repo `jhs129/contextnest-vault` stores version history via GitHub API commits and is the source of truth.

### Service 2 — read.ai webhook (follow-on, not in this spec)
- Separate Vercel deployment (Next.js or serverless function).
- `POST /webhooks/readai`, HMAC/shared-secret verify, `request_id` dedupe, `GET /healthz`.
- Transforms read.ai payload → Context Nest meeting node; calls Service 1 `create_document` as "Read.ai bot" service identity.

---

## File tree (Service 1, root of `skynest`)

```
services/contextnest-mcp-host/       # Service 1 — Next.js app
  src/app/
    api/
      mcp/route.ts                   # mcp-handler, withMcpAuth, tool registration
    oauth/
      authorize/route.ts             # OAuth 2.1 authorize endpoint
      token/route.ts                 # OAuth 2.1 token endpoint
      register/route.ts              # Dynamic client registration
    .well-known/
      oauth-authorization-server/route.ts
      oauth-protected-resource/route.ts
      jwks.json/route.ts
  src/lib/
    oauth/                           # Ported from roadmap (jwt, keys, pkce, tokens, config, urls)
    mcp/
      tools.ts                       # Registers forked-engine tools on the mcp-handler route
      auth.ts                        # verifyMcpToken (GitHub OAuth JWT validation)
      vault/
        github.ts                    # GitHub API commit (PUT /contents, user token) — attribution layer for WRITE tools
        provider.ts                  # Calls engine StorageFactory with CONTEXTNEST_STORAGE=blob; wires Blob config
    auth.ts                          # NextAuth config (GitHub provider only)
    auth.config.ts
  src/types/
    vault.ts                         # VaultFile, DocumentMeta, etc.
  vendor/contextnest/                # git submodule → jhs129/ContextNest (fork of PromptOwl/ContextNest)
    packages/engine/src/storage/     # Provider/Factory lives in the fork:
      storage-provider.ts            #   StorageProvider interface
      storage-factory.ts             #   createStorageProvider(config)
      providers/fs-storage-provider.ts
      providers/blob-storage-provider.ts   # @vercel/blob impl
  package.json                       # next, mcp-handler, @vercel/blob, @auth/nextjs, jose, zod
  .env.example
scripts/
  init-vault.sh                      # One-time: local vault dir → push to jhs129/contextnest-vault
infra/                               # (placeholder — Vercel project config, env var docs)
docs/
  contextnest-vercel-design.md       # Final design doc (to be written)
```

## Tech stack (updated)
- **Next.js 15 App Router**, **pnpm**, **TypeScript** — same as roadmap.
- **Forked `jhs129/ContextNest` engine** (fork of `PromptOwl/ContextNest`, AGPL-3.0) — `@promptowl/contextnest-engine` patched with a pluggable storage backend, vendored as a submodule.
- **`mcp-handler`** for MCP HTTP transport.
- **`@vercel/blob`** for vault file storage.
- **GitHub REST API** (Octokit or raw fetch) for versioned commits.
- **`@auth/nextjs`** (NextAuth v5) with GitHub provider for web session.
- **`jose`** for RS256 JWT signing/verification.
- **`zod`** for tool input validation.

## Reference
- OAuth 2.1 implementation: `jhs129/roadmap` — port authorize/token/register routes, JWT signing, mcp-handler auth middleware; swap `Google()` → `GitHub()` in NextAuth config.
- Upstream to fork: `github.com/PromptOwl/ContextNest` (AGPL-3.0) — TS monorepo (`packages/engine`, `packages/cli`, `packages/mcp-server`). Key seam: `packages/engine/src/storage.ts` (`NestStorage`), shared by `GraphQueryEngine`, `PackLoader`, `VersionManager`, `CheckpointManager`. Tool schemas + vault document format come from `packages/mcp-server` and `CONTEXT_NEST_SPEC.md` (spec is Apache-2.0).

## Deployment runbook (updated)
1. **Fork upstream:** Fork `PromptOwl/ContextNest` → `jhs129/ContextNest`. Add it to Service 1 as a submodule under `vendor/contextnest` (and add `upstream` remote for future pulls).
2. **Adapt storage (Factory/Provider):** On the fork, refactor `NestStorage` to delegate to a `StorageProvider` chosen by `createStorageProvider()`; add `FsStorageProvider` (parity/tests) and `BlobStorageProvider` (`@vercel/blob`). Make `NestStorage` methods async and update engine collaborators to `await`. Confirm secondary writers (`checkpoint.ts`, index generators) route through the provider. Set `CONTEXTNEST_STORAGE=blob` on Vercel. Build/test both providers.
3. **Vault → git:** Run `scripts/init-vault.sh <local-vault-path>` to push existing vault to new private repo `jhs129/contextnest-vault`; add team members as collaborators.
4. **GitHub OAuth App:** Register one for Service 1 (callback = `https://<vercel-app>.vercel.app/api/auth/callback/github`), `repo` scope.
5. **Vercel project:** Link repo, set env vars (see `.env.example`), deploy.
6. **Vercel Blob:** Provision a Blob store in the Vercel project dashboard; run a one-time sync from `contextnest-vault` repo → Blob on first deploy.
7. **Connect Claude Code** to Service 1; OAuth sign-in; verify tools.

## Open items (to resolve when resuming)
- **Storage = Vercel Blob (decided).** Implemented via the `BlobStorageProvider` behind the Storage Factory. Remaining sub-decision: whether to also push an upstream PR for the provider refactor (it's a clean, backend-agnostic change) vs. keep it fork-only.
- **Async refactor scope:** Making `NestStorage` async ripples into `GraphQueryEngine`/`PackLoader`/`VersionManager`/`CheckpointManager` callers. Confirm none rely on synchronous storage in tight loops that would regress perf; batch reads where the engine currently iterates file-by-file.
- **GitHub commit-on-write placement:** Keep attribution in the host's WRITE-tool path (`vault/github.ts`) so the `BlobStorageProvider` stays a pure storage backend, vs. folding it into a provider decorator. Leaning: keep it in the host (provider stays portable/testable).
- **Fork maintenance:** Keep all backend code inside `storage/providers/` + the factory to minimize merge conflicts on `upstream` pulls. Confirm AGPL-3.0 compliance for our hosting model (publish the fork / our changes, or obtain a commercial license from PromptOwl).
- **Read.ai bot identity:** Dedicated machine GitHub account vs. service token + synthetic author `readai@jhsconsulting.net` (Service 2 spec, not blocking Service 1).
- **Service 2 hosting:** Next.js on Vercel vs. Vercel serverless function only (Service 2 spec, not blocking Service 1).

## Verification (Service 1)
- **Storage providers:** Run the engine's existing test suite against `FsStorageProvider` (tmp dir) to prove parity with upstream, then against `BlobStorageProvider` (mock/in-memory Blob) to prove the contract holds for both. Include `verify_integrity` over the hash-chain after writes. Confirm the factory selects the right provider from `CONTEXTNEST_STORAGE`.
- **Integration:** Two different GitHub OAuth users each run `create_document` → confirm two commits in `contextnest-vault` with distinct, correct authors; reads return the new nodes.
- **End-to-end:** Connect Claude Code to the Vercel-hosted MCP → OAuth sign-in → create, update, search a document → verify it appears in `contextnest-vault` git history with correct attribution.
