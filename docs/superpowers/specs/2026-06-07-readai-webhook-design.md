# Skynest Service 2 — Read.ai Webhook Ingest: Design Spec

**Date:** 2026-06-07
**Status:** Approved
**Scope:** Service 2 only (Read.ai webhook ingest, Haiku client matching, vault document creation). Service 1 (MCP host + GitHub OAuth + Vercel Blob vault) is covered in the 2026-06-06 spec.

---

## Problem

Meeting reports from Read.ai need to be automatically ingested into the Skynest vault with client attribution. Read.ai can POST a webhook payload when a meeting ends, but we need a secure, always-on endpoint that verifies the request, identifies the relevant client, and creates a structured vault document — without any manual intervention.

---

## Constraints

- **Vercel serverless.** No persistent process; each invocation is stateless. Long-running work (Haiku call, vault write) must complete within `maxDuration: 60`.
- **No user OAuth token.** Inbound webhooks have no user session. Vault writes use a bot GitHub PAT (`BOT_GITHUB_TOKEN`) for commit attribution.
- **Read.ai retry behavior.** Read.ai retries up to 5 times (6 total attempts) on non-2xx. Vault write failures should return 500 to trigger a retry. All other failures (bad key, bad HMAC, duplicate) should return 200 or 401 — never trigger unnecessary retries.
- **AGPL-3.0.** No account names, repo URLs, or deployment-specific values hardcoded anywhere — all from environment variables.

---

## Approach

A Next.js App Router route at `POST /api/webhooks/[apikey]/readai`. Two-layer security: a secret path segment (unknown callers never reach HMAC verification) plus HMAC-SHA256 body verification. Client matching uses a single Haiku call (via Vercel AI Gateway) that reads both the meeting payload and a client registry document stored in the vault. The resulting structured meeting document is written to the vault using a bot identity.

---

## Repo Layout

```
src/
  app/
    api/
      webhooks/
        [apikey]/
          readai/
            route.ts          # POST handler — verification, dedup, analysis, write
  lib/
    webhooks/
      readai/
        verify.ts             # HMAC-SHA256 signature verification
        schema.ts             # Zod schema for Read.ai payload
        analyze.ts            # Haiku call via Vercel AI Gateway
        document.ts           # Meeting document builder (frontmatter + body)
        dedup.ts              # request_id deduplication via vault search
```

---

## Section 1 — Route & Security

### Route

```
POST /api/webhooks/[apikey]/readai
```

The `[apikey]` segment is a long random string stored as `WEBHOOK_API_KEY` in the environment. The full webhook URL configured in the Read.ai dashboard looks like:

```
https://your-deployment.vercel.app/api/webhooks/582941c27dd66c9e7feca5b5d43c9ae506ffda06/readai
```

Rotating the key means generating a new value, updating the env var, redeploying, and reconfiguring the Read.ai webhook URL.

### Verification sequence

1. **Path key check** — timing-safe comparison of `params.apikey` against `WEBHOOK_API_KEY`. Returns 401 on mismatch. Unknown callers never proceed further.
2. **HMAC-SHA256 body verification** — Read.ai sends `X-Read-Signature` as a hex digest. The handler computes `HMAC-SHA256(rawBody, base64Decode(READ_AI_SIGNING_KEY))` and compares using `crypto.timingSafeEqual`. Returns 401 on mismatch.
3. **Deduplication** — search vault for any document with `request_id` matching the payload's `request_id`. If found, return 200 immediately (idempotent).

After step 2 passes, return 200 to Read.ai. Remaining work (Haiku analysis, vault write) continues via `waitUntil` from `@vercel/functions` so Read.ai's timeout is never a concern.

---

## Section 2 — Client Registry

A standard vault document editable via MCP tools — no deploy required to add or update clients.

**Path in vault:** `clients/registry.md`

**Format:**

```markdown
---
title: Client Registry
type: reference
status: published
tags: [clients, registry]
---

## Clients

### Acme Corp
- domains: acme.com, acmeinc.com
- keywords: acme, widget, supply chain
- contacts: jane@acme.com, bob@acmeinc.com

### JHS Consulting
- domains: jhsconsulting.net
- keywords: consulting, advisory
- contacts: john@jhsconsulting.net
```

The handler reads this document from Vercel Blob before the Haiku call. If the document does not exist, Haiku receives an empty registry and `client` defaults to `"unknown"`.

---

## Section 3 — Haiku Analysis (Vercel AI Gateway)

### Model

`anthropic/claude-haiku-4-5` via Vercel AI Gateway. Uses the `ai` package (Vercel AI SDK) with the gateway endpoint — no provider-specific package (`@ai-sdk/anthropic`) required.

```ts
import { generateText } from 'ai';

const { text } = await generateText({
  model: 'anthropic/claude-haiku-4-5',
  prompt: buildPrompt(payload, registryText),
});
```

The gateway key is read from `VERCEL_AI_GATEWAY_KEY`.

### Prompt

The prompt passes:
- Full meeting payload fields: `title`, `summary`, `participants`, `topics`, `action_items`, `chapter_summaries`
- Raw client registry markdown text

And requests a single JSON response:

```json
{
  "client": "Acme Corp",
  "client_slug": "acme-corp",
  "confidence": "high",
  "tags": ["quarterly-review", "action-items"],
  "summary": "2-3 sentence summary.",
  "action_items": ["Follow up on contract renewal by June 30"]
}
```

### Validation

Response parsed with Zod. If parsing fails or `confidence` is `"low"`, `client` is forced to `"unknown"` and `client_slug` to `"unknown"`. The document is always written — meeting data is never lost.

---

## Section 4 — Meeting Document Format

Written to the vault at `meetings/{session_id}.md`.

```markdown
---
title: "Acme Corp — Quarterly Review"
type: meeting
status: published
client: acme-corp
tags: [quarterly-review, action-items, acme]
meeting_date: 2026-06-07T14:00:00Z
participants:
  - jane@acme.com
  - john@jhsconsulting.net
platform: zoom
report_url: https://app.read.ai/analytics/sessions/abc123
request_id: req_abc123
source: readai
haiku_confidence: high
---

## Summary

2-3 sentence summary from Haiku.

## Action Items

- Follow up on contract renewal by June 30
- Send updated proposal to Jane

## Topics

- Quarterly performance review
- Roadmap for Q3

## Participants

- Jane Smith (jane@acme.com)
- John Schneider (john@jhsconsulting.net)
```

`request_id` in frontmatter is the deduplication key. `haiku_confidence` surfaces low-confidence matches for easy filtering via MCP search.

### Bot identity

`createEngine(BOT_GITHUB_TOKEN)` — the existing vault engine's `GitHubVaultSyncProvider` uses the token to commit. Commits are attributed to whichever GitHub account owns the PAT. A dedicated service account (`skynest-bot`) is recommended but not required.

---

## Section 5 — Error Handling

| Scenario | Response | Behavior |
|---|---|---|
| Wrong path key | 401 | Silent rejection — no information to caller |
| Invalid HMAC | 401 | Misconfigured key or bad actor |
| Duplicate `request_id` | 200 | Idempotent — already processed |
| Client registry missing | Continue | `client: unknown`, Haiku gets empty registry |
| Haiku call fails | Continue | Document written with `client: unknown`, `haiku_error: true` in frontmatter |
| Haiku returns unparseable JSON | Continue | Same as above — meeting data never lost |
| Vault blob write fails | 500 | Triggers Read.ai retry (up to 5 attempts) |
| Git sync failure | Logged | Fire-and-forget per Service 1 design — blob write is authoritative |

---

## Section 6 — Environment Variables

New variables (additions to the Service 1 set):

| Variable | Required | Description |
|---|---|---|
| `WEBHOOK_API_KEY` | Yes | Secret path segment — long random string in the webhook URL |
| `READ_AI_SIGNING_KEY` | Yes | Base64-encoded HMAC signing key from Read.ai dashboard |
| `BOT_GITHUB_TOKEN` | Yes | GitHub PAT with `repo` scope for bot vault commits |
| `VERCEL_AI_GATEWAY_KEY` | Yes | Vercel AI Gateway API key |

---

## Section 7 — Testing

**Unit:**
- `verify.ts` — valid signature passes, tampered body fails, wrong key fails, timing-safe comparison confirmed
- `analyze.ts` — mock AI SDK; assert prompt contains registry text and payload fields; assert Zod validation handles bad JSON gracefully
- `document.ts` — assert correct frontmatter and body for known input
- `dedup.ts` — mock vault search; assert duplicate `request_id` returns true

**Integration:**
- POST a valid signed payload to the route with a test `WEBHOOK_API_KEY` → assert document appears in vault with correct client slug
- POST same payload twice → assert second call returns 200 without creating a duplicate document
- POST with wrong path key → assert 401, no vault write
- POST with invalid HMAC → assert 401, no vault write
- POST with missing client registry → assert document created with `client: unknown`

**End-to-end:**
- Configure Read.ai sandbox webhook → trigger a meeting end event → verify document appears in vault with correct client attribution and commit attributed to bot identity

---

## Open Items

- **`waitUntil` availability:** confirm `@vercel/functions` `waitUntil` works correctly with Next.js 15 App Router in the version currently deployed. If not available, the handler can process synchronously within `maxDuration: 60`.
- **Bot account:** decide whether `BOT_GITHUB_TOKEN` belongs to a dedicated `skynest-bot` GitHub account or the repo owner's account. Dedicated account gives cleaner audit trail.
- **Transcript inclusion:** the Read.ai payload includes a full `transcript` field. Excluded from the vault document by default (can be large). Consider a `READAI_INCLUDE_TRANSCRIPT=true` env flag if needed later.
- **Multi-vault support:** `createEngine` accepts an optional `vaultId`. Webhook handler uses the default vault. Multi-tenant routing (different vaults per client) is out of scope for this spec.
