# Plan: Hosted Context Nest MCP + read.ai ingestion on Vercel (git-backed, GitHub OAuth)

> Intended home: the dedicated repo **`jhs129/skynest`** (this copy lives in `claude-jhsdc` only for transfer).

## Context

**Why:** John wants his Context Nest vault to be **always available remotely** (not tied to his Mac), **versioned/backed up in git**, **multi-user with per-user attribution**, and fed automatically by **read.ai meeting reports** — all without requiring users to understand git.

**Current state:** On John's Mac the Context Nest MCP server runs locally over **stdio**, and the vault filesystem sits on a **drive mapped to OneDrive** that syncs to his team. Works locally, but has no always-on/remote/multi-user story.

**Hard constraint:** Context Nest (the `@promptowl/contextnest-*` packages) is built around a **local persistent filesystem** — the engine reads/writes a vault directory and the MCP server runs over **stdio** with a `CONTEXTNEST_VAULT_PATH`. Vercel's serverless runtime has **no persistent, writable, shared filesystem** (only an ephemeral, per-invocation `/tmp` that is not shared across instances and is wiped between cold starts). So the upstream project cannot run unmodified on Vercel.

**Approach (revised — fork & adapt, not reimplement):** Rather than reimplementing the 14–20 tools from scratch, **fork `PromptOwl/ContextNest` → `jhs129/ContextNest`** and adapt its storage layer so the same engine/tool logic runs on Vercel. Investigation of the engine shows I/O is centralized: a single `NestStorage` class (`packages/engine/src/storage.ts`) backs `GraphQueryEngine`, `PackLoader`, `VersionManager`, and `CheckpointManager` through one shared storage instance. That seam is what we replace. Two storage strategies are on the table (see "Forking & filesystem strategy" below); the recommended backing store for file contents is **Vercel Blob**, with the **GitHub REST API** providing versioning + per-user attribution (commits via the user's OAuth token — no `git clone`/`git push` needed). Reimplementing the tools natively is retained only as a fallback if the fork proves too costly to track upstream.

**Decisions confirmed:**
- **Deployment: Vercel** (not Azure). Next.js App Router, same stack as `jhs129/roadmap`.
- **Fork the upstream project:** Fork `github.com/PromptOwl/ContextNest` → **`jhs129/ContextNest`** and adapt it for Vercel rather than reimplementing. AGPL-3.0 obligations are met by keeping the fork's source public (or making our modifications available); commercial licensing from PromptOwl is the alternative if we need to keep changes closed.
- **Filesystem on Vercel:** Solve the "no persistent local filesystem" problem with a pluggable **storage backend** behind the engine's `NestStorage` seam. Primary store = **Vercel Blob**; version history/attribution = **GitHub REST API**. (Vercel `/tmp`-hydration is the lower-effort fallback — see strategy section.)
- **Phasing: Service 1 first** (hosted MCP + GitHub OAuth + vault writes), then Service 2 (read.ai webhook ingest) as a follow-on spec/plan.
- **Writes are attributed per user** via **GitHub OAuth** — user's own token with `repo` scope is used for GitHub API commits (native attribution). No central service account push.
- **Vault storage: Vercel Blob** for file contents (individual markdown objects). **GitHub repo `jhs129/contextnest-vault`** remains the source of truth for version history; writes go through the GitHub API, not git CLI.
- **Vault init script:** A one-time `scripts/init-vault.sh` in this repo takes a local vault directory and pushes it to a new private GitHub repo.
- **OAuth: GitHub OAuth only** (no Google, no Microsoft). Port the full OAuth 2.1 implementation from `jhs129/roadmap` (authorize/token/register endpoints, RS256 JWTs, PKCE, `.well-known` metadata, `mcp-handler` middleware) and swap the provider from Google to GitHub.
- **MCP transport: Next.js + `mcp-handler`** (same as roadmap). MCP tools exposed via `/api/mcp` route with `withMcpAuth` middleware.
- **OneDrive:** demoted to optional passive backup; the hosted MCP is the access path going forward.

**Open item (paused here):**
- **Vault read path:** Should vault reads go through Vercel Blob (fast, ~0ms) or GitHub API (single source of truth, ~100–200ms latency per call)? Option A (Blob + GitHub API) vs Option C (GitHub API only) — to be decided when resuming.

---

## Forking & filesystem strategy

**Step 0 — fork:** Fork `PromptOwl/ContextNest` → `jhs129/ContextNest`. Add `PromptOwl/ContextNest` as an `upstream` remote so we can pull future releases. Consume it from Service 1 either as a **git submodule** under `services/contextnest-mcp-host/vendor/contextnest`, or by publishing the patched `@promptowl/contextnest-engine` to a private package and depending on it. Submodule is preferred early (easier to iterate + diff against upstream).

**The seam:** The engine concentrates I/O in `packages/engine/src/storage.ts` (`NestStorage`), shared by `GraphQueryEngine`, `PackLoader`, `VersionManager`, and `CheckpointManager`. We make the vault backend pluggable behind a small interface (`read(path)`, `write(path, bytes)`, `delete(path)`, `list(prefix)`, `exists(path)`). Audit secondary writers too — `checkpoint.ts`, `index-generator.ts`, `index-md-generator.ts` may touch `fs` directly and must route through the same interface.

Two ways to satisfy the filesystem need on Vercel — pick one, recommendation is **Option 1**:

- **Option 1 — Blob-backed storage adapter (recommended).** Implement `NestStorage` against **Vercel Blob** (`@vercel/blob`): each vault file is a Blob object keyed by its relative vault path; `context.yaml`/index regenerate into Blob on every mutation. WRITE tools additionally commit through the **GitHub REST API** (`PUT /repos/jhs129/contextnest-vault/contents/...`) using the session user's OAuth token, giving native per-user attribution and full version history. Pros: fast reads (~0ms), no cold-start hydration cost, availability decoupled from GitHub rate limits. Cons: most code change in the fork; Blob is eventually consistent, so the GitHub repo (not Blob) is the source of truth. *This is the cleanest long-term fit and matches the existing Blob + GitHub design already in this plan.*

- **Option 2 — Ephemeral `/tmp` hydration (lower fork effort, fallback).** Leave the engine's `fs` code essentially untouched. On cold start (or per request), **hydrate a working copy into `/tmp/vault`** from Blob or by cloning/tarball-fetching `contextnest-vault`, set `CONTEXTNEST_VAULT_PATH=/tmp/vault`, run the unmodified engine, then **persist mutations back** (write changed files to Blob and/or commit via GitHub API) at the end of the request. Pros: minimal divergence from upstream, easiest to keep in sync. Cons: cold-start latency to hydrate, `/tmp` is per-instance and not shared (concurrent writers can race), and write-back must be reconciled carefully. Good for a fast first deploy / proof of concept.

**Why not other stores:** Vercel's own guidance is that serverless functions are stateless and only `/tmp` is writable (ephemeral, ~512MB, per-instance) — durable state must go to a managed store. **Vercel Blob** is the recommended fit for opaque file/markdown objects (which is exactly what a vault is). Alternatives considered: a network filesystem/EFS-style mount (not offered by Vercel), S3/R2 (works but adds a second vendor when Blob already covers it), or a database/KV (poor fit for whole-markdown-file semantics and git diffing). Blob + GitHub API stays closest to Context Nest's file-per-node model.

**Transport note:** the upstream MCP server speaks **stdio**; on Vercel we don't run that process. Service 1 keeps its own `/api/mcp` route (`mcp-handler` + GitHub OAuth) and calls the **forked engine as a library** (import `GraphQueryEngine`/`NestStorage` etc.), so we reuse tool *logic* without the stdio process or a vault path on disk.

---

## Architecture (updated)

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │ Service 1 — Hosted Context Nest MCP server (Vercel / Next.js)         │
   │   • Next.js App Router, mcp-handler, /api/mcp route                   │
   │   • GitHub OAuth 2.1 (ported from jhs129/roadmap)                     │
   │   • Forked engine (jhs129/ContextNest) used as a library              │
   │     — NestStorage swapped for a Blob-backed storage adapter           │
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
- **Tool layer:** the **forked `jhs129/ContextNest` engine** imported as a library (submodule or private package), exposing its existing tool/engine logic through the `/api/mcp` route. No stdio process, no vault path on disk. The engine's `NestStorage` is swapped for a **Blob-backed storage adapter** (Option 1 above). Tool surface (upstream exposes ~18–20):
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
        blob.ts                      # Vercel Blob read/write helpers
        github.ts                    # GitHub API commit (PUT /contents, user token)
        storage-adapter.ts           # Implements engine NestStorage iface over blob.ts + github.ts
    auth.ts                          # NextAuth config (GitHub provider only)
    auth.config.ts
  src/types/
    vault.ts                         # VaultFile, DocumentMeta, etc.
  vendor/contextnest/                # git submodule → jhs129/ContextNest (fork of PromptOwl/ContextNest)
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
2. **Adapt storage:** On the fork, refactor `NestStorage` to a pluggable interface and implement the Blob + GitHub storage adapter (Option 1). Confirm secondary writers (`checkpoint.ts`, index generators) route through it. Build/test against a mock backend.
3. **Vault → git:** Run `scripts/init-vault.sh <local-vault-path>` to push existing vault to new private repo `jhs129/contextnest-vault`; add team members as collaborators.
4. **GitHub OAuth App:** Register one for Service 1 (callback = `https://<vercel-app>.vercel.app/api/auth/callback/github`), `repo` scope.
5. **Vercel project:** Link repo, set env vars (see `.env.example`), deploy.
6. **Vercel Blob:** Provision a Blob store in the Vercel project dashboard; run a one-time sync from `contextnest-vault` repo → Blob on first deploy.
7. **Connect Claude Code** to Service 1; OAuth sign-in; verify tools.

## Open items (to resolve when resuming)
- **Filesystem strategy (highest priority):** Option 1 (Blob-backed storage adapter on the fork) vs. Option 2 (`/tmp` hydration). *Recommendation: Option 1* for performance and durability; Option 2 acceptable for a quick first proof of concept. See "Forking & filesystem strategy".
- **Fork maintenance:** How aggressively to track upstream `PromptOwl/ContextNest`. Keep storage changes isolated to the `NestStorage` seam to minimize merge conflicts on `upstream` pulls. Confirm AGPL-3.0 compliance for our hosting model (publish the fork / our changes, or obtain a commercial license from PromptOwl).
- **Vault read path:** Reads from Vercel Blob (fast) with writes to both Blob + GitHub API (the leaning), vs. GitHub API only (no Blob, ~100–200ms/read, always matches git). Subsumed by the Option 1/2 decision above.
- **Read.ai bot identity:** Dedicated machine GitHub account vs. service token + synthetic author `readai@jhsconsulting.net` (Service 2 spec, not blocking Service 1).
- **Service 2 hosting:** Next.js on Vercel vs. Vercel serverless function only (Service 2 spec, not blocking Service 1).

## Verification (Service 1)
- **Storage adapter:** The forked engine's tool handlers tested against a mock Blob + mock GitHub API backend (the swapped `NestStorage` implementation), including `verify_integrity` over the hash-chain after writes.
- **Integration:** Two different GitHub OAuth users each run `create_document` → confirm two commits in `contextnest-vault` with distinct, correct authors; reads return the new nodes.
- **End-to-end:** Connect Claude Code to the Vercel-hosted MCP → OAuth sign-in → create, update, search a document → verify it appears in `contextnest-vault` git history with correct attribution.
