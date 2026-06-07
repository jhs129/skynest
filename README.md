# Skynest

**Your team's knowledge, always available.**

Skynest brings [Context Nest](https://github.com/PromptOwl/ContextNest) to the cloud — a hosted MCP server your whole team can connect to from any AI tool, anywhere, without running anything locally.

---

## What is Skynest?

### Built on Context Nest

[Context Nest](https://github.com/PromptOwl/ContextNest) (by [PromptOwl](https://promptowl.ai)) is a structured knowledge vault for AI tools. Rather than dumping raw files at an AI, it organizes information as interconnected documents — nodes with graph relationships, pack bundles, semantic indexing, and full version history — purpose-built for AI consumption. Teams use it to share meeting notes, project decisions, architectural context, and reference documentation directly with Claude, Cursor, and other AI tools through the Model Context Protocol (MCP).

### The limitation: it's tied to your machine

The original Context Nest runs as a local stdio MCP server with vault files on your filesystem. That means it only works when your machine is on and the server process is running. Sharing the vault via OneDrive or Dropbox can extend access to teammates, but requires every person to have the right drive mapped and synced — and there's no built-in multi-user story. Writes from different people can conflict silently, and nothing links a document change to the person who made it.

### What Skynest adds: cloud deployment

Skynest adapts Context Nest for serverless cloud deployment on Vercel. It replaces the local filesystem with **Vercel Blob** — durable, globally accessible object storage — so vault documents are always available without any local process running. Authentication is handled by **GitHub OAuth 2.1**: every team member signs in with their own GitHub account, and every write is committed to a private GitHub repository under that user's identity. You get a complete, accurate audit trail of who wrote what and when, using real git commits — not a synthetic log.

All 18+ Context Nest MCP tools — `read_document`, `search`, `create_document`, `update_document`, `read_version`, integrity checks, and more — are exposed over HTTPS. Connect once from Claude Code, Cursor, or any MCP-compatible AI tool, and your team's entire knowledge vault is immediately accessible from any machine, any time.

> Skynest is built on the open-source Context Nest engine by PromptOwl (AGPL-3.0). The vault storage layer has been adapted to run on Vercel's serverless infrastructure, with GitHub OAuth and Vercel Blob replacing the local filesystem.

---

## Features

| | |
|---|---|
| **Always on** | Deployed on Vercel — your vault is reachable over HTTPS 24/7, not just when your Mac is open. |
| **Multi-user** | Every team member signs in with their own GitHub account. Writes are committed with native git attribution. |
| **Git-versioned** | Every document change is a real commit in a private GitHub repository — full history, diffs, and rollback. |

---

## How it works

1. Sign in with your GitHub account when prompted by your AI tool.
2. Skynest authenticates you via OAuth and issues a secure session token.
3. Your AI tool can now read, search, create, and update vault documents over MCP.
4. Every write is committed to the vault repo under your GitHub identity.

---

## Architecture

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │ Skynest — Hosted Context Nest MCP server (Vercel / Next.js)           │
   │   • Next.js App Router, mcp-handler, /api/mcp route                   │
   │   • GitHub OAuth 2.1 (PKCE + dynamic client registration + RS256 JWT) │
   │   • Context Nest engine (vendored fork) used as a library             │
   │     — StorageProvider interface; BlobStorageProvider on Vercel        │
   │   • Vault files: Vercel Blob (read/write) + GitHub API (commit/history)│
   │   • WRITE tools → Vercel Blob put → GitHub API PUT /contents           │
   │                    (commit attributed to session user's GitHub token)   │
   └───────▲──────────────────────────────────────────────┬────────────────┘
           │ MCP over HTTPS (GitHub OAuth)                 │ GitHub API
           │                                               ▼
   Claude Code / Cursor /                        Private git repo
   any MCP-compatible tool                       <owner>/contextnest-vault
   (each user's own GitHub                       (source of truth +
    account → attributed commits)                 full version history)
```

**Tech stack:** Next.js 15 App Router · TypeScript · pnpm · `mcp-handler` · `@vercel/blob` · NextAuth v5 (GitHub provider) · `jose` (RS256 JWTs) · `zod`

---

## Deploying Skynest

### Prerequisites

- A [Vercel](https://vercel.com) account
- A [GitHub](https://github.com) account (for OAuth App registration and vault repo)
- `pnpm` >= 9, Node.js >= 20
- An existing Context Nest vault (or a new one initialized with the `ctx` CLI)

### 1. Create the vault repository

Push your existing vault to a new **private** GitHub repository, or create an empty one and initialize it later. This repo (`<owner>/contextnest-vault`) becomes the source of truth for version history.

```bash
# From your local vault directory
bash scripts/init-vault.sh <local-vault-path>
```

Add each team member as a collaborator on the vault repository.

### 2. Register a GitHub OAuth App

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App** and fill in:

| Field | Value |
|---|---|
| Application name | Skynest |
| Homepage URL | `https://<your-vercel-app>.vercel.app` |
| Authorization callback URL | `https://<your-vercel-app>.vercel.app/api/auth/callback/github` |

Note the **Client ID** and **Client Secret** — you'll need them in the next step.

### 3. Generate OAuth signing keys

```bash
pnpm oauth:gen-keypair
```

This outputs `OAUTH_PRIVATE_KEY` and `OAUTH_PUBLIC_KEY` values for your environment.

### 4. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/jhs129/skynest)

Or deploy via the CLI:

```bash
pnpm dlx vercel
```

### 5. Set environment variables

In the Vercel project dashboard (**Settings → Environment Variables**), add the following:

```bash
# GitHub OAuth App
AUTH_GITHUB_ID=<your-github-oauth-client-id>
AUTH_GITHUB_SECRET=<your-github-oauth-client-secret>

# NextAuth
AUTH_SECRET=<random-32-char-string>  # openssl rand -base64 32
NEXTAUTH_URL=https://<your-vercel-app>.vercel.app

# OAuth JWT signing (from step 3)
OAUTH_PRIVATE_KEY=<generated-private-key>
OAUTH_PUBLIC_KEY=<generated-public-key>

# Vault GitHub repo (owner/repo)
VAULT_GITHUB_OWNER=<github-username-or-org>
VAULT_GITHUB_REPO=contextnest-vault

# Vercel Blob (auto-populated when you connect a Blob store)
BLOB_READ_WRITE_TOKEN=<vercel-blob-token>

# Storage backend
CONTEXTNEST_STORAGE=blob
```

See `.env.example` for the full list with descriptions.

### 6. Provision Vercel Blob

In the Vercel project dashboard, go to **Storage → Connect Store** and create or attach a Blob store. The `BLOB_READ_WRITE_TOKEN` will be added automatically.

Then run a one-time sync to populate Blob from the vault repo:

```bash
VAULT_GITHUB_OWNER=<owner> VAULT_GITHUB_REPO=contextnest-vault \
  pnpm tsx scripts/sync-vault-to-blob.ts
```

### 7. Redeploy and verify

Trigger a fresh deployment. Visit your Vercel URL — you should see the Skynest home page. The MCP endpoint is live at `https://<your-vercel-app>.vercel.app/api/mcp`.

---

## Connecting your AI tool

### Prerequisites

- A **GitHub account** — Skynest uses GitHub OAuth for authentication. You'll be prompted to authorize on first connection.
- **Vault access** — ask your Skynest admin to add your GitHub username as a collaborator on the vault repository.

Replace `YOUR_SKYNEST_URL` below with your actual deployment URL.

### Claude Code CLI

```bash
claude mcp add --transport http skynest https://YOUR_SKYNEST_URL/api/mcp
```

Restart Claude Code. On first use you'll be prompted to sign in with GitHub.

<details>
<summary>Manual config alternative</summary>

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "skynest": {
      "type": "http",
      "url": "https://YOUR_SKYNEST_URL/api/mcp"
    }
  }
}
```
</details>

### Claude Code App (Desktop)

1. Open Claude Code and go to **Settings**.
2. Navigate to **MCP Servers** and click **Add Server**.
3. Enter:
   ```
   Name:      skynest
   Transport: HTTP
   URL:       https://YOUR_SKYNEST_URL/api/mcp
   ```
4. Save and restart. You'll be prompted to sign in with GitHub on first use.

### Cursor

Add to your project's `.cursor/mcp.json` (or the global Cursor MCP config):

```json
{
  "mcpServers": {
    "skynest": {
      "url": "https://YOUR_SKYNEST_URL/api/mcp",
      "transport": "http"
    }
  }
}
```

Reload Cursor. On first use, a browser window will open for GitHub OAuth sign-in.

### Other MCP-compatible tools

Skynest exposes a standard MCP HTTP endpoint with OAuth 2.1. Any tool that supports MCP over HTTP with OAuth 2.1 should work — use `https://YOUR_SKYNEST_URL/api/mcp` as the endpoint.

---

## Available MCP tools

**Read tools**

| Tool | Description |
|---|---|
| `vault_info` | Get vault identity and configuration summary |
| `resolve` | Execute a selector query with graph traversal |
| `read_document` | Read a document by URI or path |
| `list_documents` | List documents with optional type/status/tag filters |
| `document_format` | Get the document format spec |
| `read_index` | Return the context.yaml index |
| `read_pack` | Resolve and return a context pack with documents |
| `search` | Full-text search with graph traversal |
| `verify_integrity` | Verify all hash chains |
| `list_checkpoints` | List recent checkpoints |
| `read_version` | Read a specific version of a document |

**Write tools** (each write is committed to the vault repo under your GitHub identity)

| Tool | Description |
|---|---|
| `create_document` | Create a new document with frontmatter and optional body |
| `update_document` | Update a document's title, tags, status, or body |
| `delete_document` | Delete a document and its version history |
| `publish_document` | Publish a document (bump version, create checkpoint) |

---

## Local development

```bash
# Install dependencies
pnpm install

# Build the vendored engine
pnpm --filter @promptowl/contextnest-engine build

# Copy .env.example and fill in values
cp .env.example .env.local

# Start the dev server
pnpm dev
```

The app runs at `http://localhost:3000`. The MCP endpoint is at `http://localhost:3000/api/mcp`.

For local development, set `CONTEXTNEST_STORAGE=fs` and `CONTEXTNEST_VAULT_PATH=/path/to/your/vault` to use a local filesystem vault instead of Vercel Blob.

---

## Project structure

```
skynest/
├── src/
│   ├── app/
│   │   ├── api/mcp/route.ts          # MCP endpoint (mcp-handler + OAuth middleware)
│   │   ├── oauth/                    # OAuth 2.1 authorize/token/register endpoints
│   │   ├── .well-known/              # OAuth metadata + JWKS endpoints
│   │   ├── faq/page.tsx              # Connection guide
│   │   └── page.tsx                  # Home page
│   ├── components/
│   └── lib/
│       ├── oauth/                    # JWT signing, PKCE, token helpers
│       └── mcp/
│           ├── tools.ts              # Tool registration
│           ├── auth.ts               # MCP token validation
│           └── vault/
│               ├── github.ts         # GitHub API commit layer (write attribution)
│               └── provider.ts       # Storage factory wiring (Blob provider)
├── vendor/                           # Vendored Context Nest engine (fork of PromptOwl/ContextNest)
├── scripts/                          # init-vault, sync-vault-to-blob, oauth-gen-keypair
├── vercel.json
└── .env.example
```

---

## License

The Context Nest engine vendored in this repository is licensed under **AGPL-3.0** by [PromptOwl](https://promptowl.ai). The Skynest host application (everything outside `vendor/`) is the work of its contributors. By hosting this project you accept the AGPL-3.0 obligations — the source of your modifications must be made available. Commercial licensing is available from [PromptOwl](https://promptowl.ai) if you need to embed or redistribute without AGPL obligations.
