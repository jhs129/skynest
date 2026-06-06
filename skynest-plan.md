# Plan: Hosted Context Nest MCP + read.ai ingestion on Vercel (git-backed, GitHub OAuth)

> Intended home: the dedicated repo **`jhs129/skynest`** (this copy lives in `claude-jhsdc` only for transfer).

## Context

**Why:** John wants his Context Nest vault to be **always available remotely** (not tied to his Mac), **versioned/backed up in git**, **multi-user with per-user attribution**, and fed automatically by **read.ai meeting reports** — all without requiring users to understand git.

**Current state:** On John's Mac the Context Nest MCP server runs locally over **stdio**, and the vault filesystem sits on a **drive mapped to OneDrive** that syncs to his team. Works locally, but has no always-on/remote/multi-user story.

**Hard constraint (revised):** The original plan proxied the `contextnest-mcp` stdio binary, but that binary requires a **local persistent filesystem** which is incompatible with Vercel's serverless model. Decision: **reimplement the 14 Context Nest tools natively in TypeScript** — no binary dependency. Vault files are stored in **Vercel Blob** as individual markdown objects. Versioning + per-user attribution is handled via the **GitHub REST API** (`PUT /repos/.../contents/...`), which creates commits natively using the user's OAuth token — no `git clone`, no `git push`, no filesystem needed.

**Decisions confirmed:**
- **Deployment: Vercel** (not Azure). Next.js App Router, same stack as `jhs129/roadmap`.
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

## Architecture (updated)

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │ Service 1 — Hosted Context Nest MCP server (Vercel / Next.js)         │
   │   • Next.js App Router, mcp-handler, /api/mcp route                   │
   │   • GitHub OAuth 2.1 (ported from jhs129/roadmap)                     │
   │   • 14 CN tools reimplemented natively in TypeScript (no binary)       │
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
- **Tool layer:** 14 Context Nest tools reimplemented natively in TypeScript. No stdio binary. Tool categories:
  - **Read:** `resolve`, `search`, `get_document`, `list_documents`, `read_index`, `read_pack`, `read_version`, `list_checkpoints` — read from Vercel Blob.
  - **Write:** `create_document`, `update_document`, `delete_document`, `publish_document` — write to Vercel Blob, then commit via GitHub API with user attribution.
  - **Utility:** `document_format`, `verify_integrity` — stateless validation.
- **Auth:** GitHub OAuth 2.1, ported from `jhs129/roadmap`. Full PKCE + dynamic client registration + RS256 JWTs. The GitHub access token (with `repo` scope) is stored in the session and used for GitHub API write calls.
- **Vault storage:** Vercel Blob stores vault files as markdown objects (key = relative vault path). GitHub repo `jhs129/contextnest-vault` stores version history via GitHub API commits.

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
      tools.ts                       # 14 CN tool definitions
      auth.ts                        # verifyMcpToken (GitHub OAuth JWT validation)
      vault/
        blob.ts                      # Vercel Blob read/write helpers
        github.ts                    # GitHub API commit (PUT /contents, user token)
        index.ts                     # Vault facade: get/put/delete/list
    auth.ts                          # NextAuth config (GitHub provider only)
    auth.config.ts
  src/types/
    vault.ts                         # VaultFile, DocumentMeta, etc.
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
- **`mcp-handler`** for MCP HTTP transport.
- **`@vercel/blob`** for vault file storage.
- **GitHub REST API** (Octokit or raw fetch) for versioned commits.
- **`@auth/nextjs`** (NextAuth v5) with GitHub provider for web session.
- **`jose`** for RS256 JWT signing/verification.
- **`zod`** for tool input validation.

## Reference
- OAuth 2.1 implementation: `jhs129/roadmap` — port authorize/token/register routes, JWT signing, mcp-handler auth middleware; swap `Google()` → `GitHub()` in NextAuth config.
- Context Nest tool spec: `@promptowl/contextnest-mcp-server` (AGPL-3.0) — reference the 14 tool schemas and vault document format.

## Deployment runbook (updated)
1. **Vault → git:** Run `scripts/init-vault.sh <local-vault-path>` to push existing vault to new private repo `jhs129/contextnest-vault`; add team members as collaborators.
2. **GitHub OAuth App:** Register one for Service 1 (callback = `https://<vercel-app>.vercel.app/api/auth/callback/github`), `repo` scope.
3. **Vercel project:** Link repo, set env vars (see `.env.example`), deploy.
4. **Vercel Blob:** Provision a Blob store in the Vercel project dashboard; run a one-time sync from `contextnest-vault` repo → Blob on first deploy.
5. **Connect Claude Code** to Service 1; OAuth sign-in; verify tools.

## Open items (to resolve when resuming)
- **Vault read path (highest priority):** 
  - **Option A:** Reads from Vercel Blob (fast), writes to both Blob + GitHub API. Blob is the live working copy; GitHub is the history/backup.
  - **Option C:** All reads and writes go through GitHub API only. No Blob. Simpler, but ~100–200ms latency per read call. Vault contents always match the git repo exactly.
  - *Recommendation leaning toward A* — Blob reads are faster and decouple availability from GitHub API rate limits.
- **Read.ai bot identity:** Dedicated machine GitHub account vs. service token + synthetic author `readai@jhsconsulting.net` (Service 2 spec, not blocking Service 1).
- **Service 2 hosting:** Next.js on Vercel vs. Vercel serverless function only (Service 2 spec, not blocking Service 1).

## Verification (Service 1)
- **Unit:** Each of the 14 tool handlers tested against mock Blob + mock GitHub API responses.
- **Integration:** Two different GitHub OAuth users each run `create_document` → confirm two commits in `contextnest-vault` with distinct, correct authors; reads return the new nodes.
- **End-to-end:** Connect Claude Code to the Vercel-hosted MCP → OAuth sign-in → create, update, search a document → verify it appears in `contextnest-vault` git history with correct attribution.
