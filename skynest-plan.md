# Plan: Hosted Context Nest MCP + read.ai ingestion in Azure (git-backed, GitHub OAuth)

> Intended home: the dedicated repo **`jhs129/skynest`** (this copy lives in `claude-jhsdc` only for transfer).

## Context

**Why:** John wants his Context Nest vault to be **always available remotely** (not tied to his Mac), **versioned/backed up in git**, **multi-user with per-user attribution**, and fed automatically by **read.ai meeting reports** — all without requiring users to understand git.

**Current state:** On John's Mac the Context Nest MCP server runs locally over **stdio**, and the vault filesystem sits on a **drive mapped to OneDrive** that syncs to his team. Works locally, but has no always-on/remote/multi-user story.

**Hard constraint:** Context Nest ([PromptOwl/ContextNest](https://github.com/PromptOwl/ContextNest), AGPL-3.0) ships a **stdio-only** MCP server (`@promptowl/contextnest-mcp-server`, binary `contextnest-mcp`, 14 tools incl. `create_document`/`update_document`/`delete_document`/`publish_document`) over a **local-filesystem markdown vault** (`CONTEXTNEST_VAULT_PATH`). No HTTP transport, no auth, no git, no Dockerfile. So the hosted/multi-user/git/attribution behavior must be **built as a wrapper** around it.

**Decisions confirmed by John:**
- **Two hosted Azure services** (below).
- The **MCP server is the single writer to git** — every write tool does `commit` + `push`, so context is always-available remotely *and* versioned.
- **Writes are attributed per user** via **GitHub OAuth** sign-in (native GitHub attribution).
- The **read.ai webhook is an MCP client** of the hosted MCP server (it submits notes *through* the server, never touching git/filesystem itself).
- Users need **no git knowledge** — at most a **GitHub account** (used for OAuth + commit attribution).

**Outcome:** A git-backed Context Nest accessible over HTTPS by Claude Code (John now, ~20-person team later — same deployment, just add repo collaborators), with read.ai meetings auto-ingested and full per-user version history. This collapses the old OneDrive-distribution problem: the hosted MCP is the single front door, so **OneDrive is no longer load-bearing** (optional passive backup only).

This is **greenfield**, and lives in the dedicated repo `jhs129/skynest` — separate from both `jhs129/claude-jhsdc` (CLI automation) and the `contextnest-vault` content repo. The file tree below is the **root of `skynest`**.

---

## Architecture

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │ Service 1 — Hosted Context Nest MCP server (Azure Container App, on)   │
   │   • HTTPS streamable-HTTP MCP transport (MCP TS SDK)                   │
   │   • GitHub OAuth (server brokers GitHub as IdP) → per-user identity    │
   │   • Proxies the 14 CN tools to an in-process stdio `contextnest-mcp`   │
   │   • Vault = git clone on Azure Files volume (CONTEXTNEST_VAULT_PATH)   │
   │   • WRITE tools → serialize → git pull → write → commit (--author=user)│
   │                    → push (user's GitHub OAuth token)                  │
   └───────▲───────────────────────▲───────────────────────────┬───────────┘
           │ MCP (GitHub OAuth)     │ MCP (service identity)    │ commit+push
           │                        │                           ▼
   John's Claude Code      ┌────────┴───────────────┐   ┌───────────────────┐
   + 20-person team        │ Service 2 — read.ai    │   │ Private git repo  │
   (each their own         │ webhook (Azure, on)    │   │ jhs129/           │
    GitHub account →       │  • POST /webhooks/readai│  │ contextnest-vault │ ◀ SOURCE OF TRUTH
    attributed commits)    │  • HMAC + request_id    │  │ (team = collabs)  │
                           │  • transform payload    │  └───────────────────┘
   read.ai ──webhook────▶  │  • MCP client → create_ │
   (meeting_end)           │    document as Read.ai  │
                           │    bot identity         │
                           └─────────────────────────┘
```

### Service 1 — Hosted Context Nest MCP server
- **Custom HTTP MCP server** (MCP TypeScript SDK, `StreamableHTTPServerTransport`) running in an **Azure Container App** (min replicas 1, external HTTPS ingress).
- **Tool layer:** spawns the stdio `contextnest-mcp` once as an in-process MCP **client**, and re-exposes all 14 tools over HTTP by **forwarding** each call. Preserves CN's parsing/versioning/integrity behavior verbatim — no tool reimplementation.
- **Auth:** GitHub OAuth. The MCP server acts as an **OAuth broker/proxy** to a GitHub OAuth App: Claude Code initiates the MCP OAuth flow, the server federates to GitHub, obtains the user's identity (login, name, email) and a token with `repo` scope, and binds it to the session.
- **Git on writes:** the forwarder **intercepts write tools** (`create_document`, `update_document`, `delete_document`, `publish_document`). After a successful write it runs, through a **single serialized queue** (to avoid git races): `git pull --rebase` → `git add -A` → `git commit --author="<user name> <user email>"` → `git push` using the **session user's GitHub OAuth token** (native attribution + per-user authorization via repo-collaborator access). On read tools, ensure the clone is reasonably fresh (periodic `git pull` / pull-on-miss).
- **Vault** lives on an **Azure Files** volume mounted at `/vault` (`CONTEXTNEST_VAULT_PATH=/vault`), initialized as a clone of the source-of-truth repo.

### Service 2 — read.ai webhook
- Separate **Azure Container App** (or Function) — `POST /webhooks/readai`, **HMAC/shared-secret verify**, **`request_id` dedupe**, `GET /healthz`.
- **Transforms** the read.ai payload → a Context Nest meeting node (frontmatter: `type: meeting`, `title`, `date` from `start_time`, `participants`, `platform`, `session_id`, `source: read.ai`; body: Summary → Action Items → Chapters → Transcript).
- Acts as an **MCP client to Service 1**, authenticating with a dedicated **"Read.ai bot" service identity** (a machine GitHub account / pre-provisioned token, since the webhook can't do interactive OAuth), and calls **`create_document`**. Service 1 performs the commit/push attributed to the bot. The webhook touches **no git and no filesystem**.

### Consumers
- **John's local Claude Code** connects to Service 1 over HTTPS via GitHub OAuth (`claude mcp add --transport http contextnest https://<app-fqdn>/mcp`, then OAuth login). The local stdio MCP + OneDrive become optional.
- **~20-person team (later, same deployment):** add each as a **collaborator** on `contextnest-vault`; they connect the same way. A **separate** clone of these two services against a separate vault repo serves a fully separate team — same parameterized infra.

---

## New files (root of `skynest`)
```
services/contextnest-mcp-host/      # Service 1
  src/server.ts            # streamable-HTTP MCP server + OAuth middleware
  src/auth-github.ts       # GitHub OAuth broker; session → {login,name,email,token}
  src/cn-proxy.ts          # spawn stdio contextnest-mcp; forward all 14 tools
  src/git-writer.ts        # serialized queue: pull→commit(--author)→push per write
  src/config.ts
  package.json             # @modelcontextprotocol/sdk, @promptowl/contextnest-mcp-server, simple-git, fastify
  Dockerfile               # node:20 + git + contextnest-mcp
services/contextnest-ingest/        # Service 2
  src/server.ts            # webhook routes, HMAC, dedupe, health
  src/transform.ts         # read.ai payload → CN node content
  src/mcp-client.ts        # MCP client → Service 1 create_document (bot identity)
  src/config.ts
  package.json             # fastify, zod, @modelcontextprotocol/sdk
  Dockerfile
infra/
  main.bicep               # ACR, Azure Files, Container Apps env + both apps, secrets/Key Vault
  deploy.sh                # az CLI build→push→deploy (exponential-backoff retry per repo convention)
docs/
  contextnest-azure-design.md   # this design, committed for the team
```
`.env.example` additions: `VAULT_REPO_URL`, `VAULT_REPO_BRANCH`, `CONTEXTNEST_VAULT_PATH=/vault`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `READAI_WEBHOOK_SECRET`, `READAI_BOT_TOKEN`, `MCP_HOST_URL`.

### Tech stack
- **Node 20 + TypeScript**, **pnpm** (house standard). Chosen because Service 1 wraps the Node `contextnest-mcp` in-process and the MCP **TypeScript SDK** is the reference implementation.
- **Fastify** (HTTP), **`simple-git`** (git ops), **`zod`** (payload validation), **`@modelcontextprotocol/sdk`** (MCP client/server transports + OAuth).

---

## Deployment runbook
1. **Vault → git:** `git init` the current OneDrive vault, push to new **private** repo `jhs129/contextnest-vault`; add team members as collaborators.
2. **GitHub OAuth App:** register one for Service 1 (callback = `https://<mcp-app-fqdn>/oauth/callback`), `repo` scope; create the **Read.ai bot** machine account/token.
3. **Provision Azure** (`infra/main.bicep` + `deploy.sh`, `az login` first): resource group, ACR, Azure Files share, Container Apps env, two Container Apps; secrets (OAuth client secret, webhook secret, bot token) in Container App secrets / Key Vault.
4. **Build & deploy** both images to ACR; Service 1 mounts the vault volume at `/vault`, min replicas 1.
5. **Configure read.ai** webhook URL = `https://<ingest-fqdn>/webhooks/readai` + secret (Pro/Enterprise plan); use **"Send test request"**.
6. **Connect Claude Code** to Service 1; OAuth sign-in; verify tools.

---

## Verification
- **Unit:** `transform.ts` against read.ai's test payload → assert frontmatter + sections; validate via MCP `document_format` + `verify_integrity`.
- **Service 1 integration:** connect an MCP client with two different GitHub OAuth users → each runs `create_document` → confirm two commits in `contextnest-vault` with **distinct, correct authors**, and that reads (`search`/`resolve`) return the new nodes.
- **Service 2 integration:** `curl` a correctly-HMAC-signed sample payload → confirm Service 1 receives a `create_document` and a **"Read.ai bot"-authored** commit lands; resend same `request_id` → no-op.
- **End-to-end:** real/test read.ai meeting → node appears in repo → John's Claude Code (hosted MCP) surfaces it; a manual edit from Claude Code shows **his** name in `git log`/GitHub.

---

## Open items to confirm at build time (recommendations in parens)
- **Per-user push model** (→ push with the user's **GitHub OAuth token** for native attribution + access control, requiring repo-collaborator membership; fallback: central service push with per-user `--author` if some users lack write access).
- **Read.ai bot identity** (→ a dedicated **machine GitHub account** with collaborator access, so its commits are clearly non-human; alternative: a service token + synthetic author `readai@jhsconsulting.net`).
- **Service 2 hosting** (→ **Azure Container App** for parity with Service 1; Azure Functions is a lighter alternative since it only needs to speak MCP outbound).
- **Vault repo host** (→ new **private GitHub repo** `jhs129/contextnest-vault`, separate from this automation repo).
- **OneDrive** (→ demote to optional passive backup; the hosted MCP is the access path going forward).