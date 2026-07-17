# Authorization scope-gating (KAN-34 follow-up)

## Context

PR #9 (branch `KAN-76`) delivered pluggable identity providers (GitHub / Entra ID)
and a pluggable audit-trail / vault-sync backend (GitHub / Azure Blob), but did not
implement the second half of KAN-34: gating `mcp:write` scope on actual
authorization (GitHub repo permissions, or Entra security group membership).
`oauth/token/route.ts` currently issues `mcp:read mcp:write` to every
authenticated user regardless of provider, and no MCP tool checks scope at all —
so even the write-tool call sites have no enforcement to hook into yet.

This spec covers building both halves: a pluggable `AuthorizationProvider`
abstraction that resolves an identity to `write` / `read` / `none`, wiring that
into token issuance, and porting tool-level `mcp:write` enforcement into
`src/lib/mcp/tools.ts`.

## Non-goals

- No changes to `oauth/authorize/route.ts`'s core PKCE/redirect flow beyond
  passing one new field through to the auth code.
- No UI/consent-screen changes.
- No changes to the Azure Blob vault-sync provider or its factory — this is
  authorization only, orthogonal to vault storage.
- No per-vault authorization config (env vars are global, unlike vault-sync's
  per-vault env suffixing) — out of scope until multi-vault deployments need it.

## Architecture

### `AuthorizationProvider` interface and factory

New directory `src/lib/authorization/`, mirroring the existing
`src/lib/vault/sync/` pattern (`VaultSyncProvider` / `createVaultSyncProvider`).

`src/lib/authorization/authorization-provider.ts`:

```ts
export type AuthorizationLevel = 'write' | 'read' | 'none';

export interface AuthorizationIdentity {
  /** IdP access token: GitHub repo-scoped token, or an Entra token usable against Microsoft Graph. */
  idpAccessToken: string;
  /**
   * Entra only. Group IDs from the ID token's `groups` claim, when present and
   * not affected by the groups-overage limit. Undefined means "claim absent or
   * overage occurred" — the provider must fall back to a Graph API call.
   */
  idpGroups?: string[];
}

export interface AuthorizationProvider {
  checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel>;
}
```

`src/lib/authorization/authorization-factory.ts`:

- `createAuthorizationProvider(): AuthorizationProvider` reads `AUTH_PROVIDER`
  (`github` default, `entra`) and returns the matching provider, constructed
  from its own env vars.
- Throws a descriptive `Error` (not a rejected promise) when required env vars
  are missing, mirroring `vault-sync-factory.ts`'s style — e.g. `AUTHZ_GITHUB_REPO
  is required when AUTH_PROVIDER=github`.

### `GitHubAuthorizationProvider`

`src/lib/authorization/providers/github-authorization-provider.ts`.

- Constructed with `{ repo: string }`, sourced from env var `AUTHZ_GITHUB_REPO`
  (`owner/repo` format). This is intentionally a separate env var from
  `VAULT_REPO` — the two will usually point at the same repo, but authorization
  and vault storage are conceptually distinct and shouldn't be coupled.
- `checkAccess({ idpAccessToken })` calls `GET https://api.github.com/repos/{repo}`
  with the user's token (porting the existing `checkRepoAccess` logic from the
  unmerged `origin/authorization` branch):
  - `permissions.admin || permissions.push` → `'write'`
  - `permissions.pull` → `'read'`
  - non-2xx response (404/403/etc.) or no recognized permission → `'none'`
- `idpGroups` is ignored (GitHub has no such concept).

### `EntraAuthorizationProvider`

`src/lib/authorization/providers/entra-authorization-provider.ts`.

- Constructed with `{ writeGroupId?: string; readGroupId?: string }`, sourced
  from `AUTHZ_ENTRA_WRITE_GROUP_ID` / `AUTHZ_ENTRA_READ_GROUP_ID`.
- `checkAccess({ idpAccessToken, idpGroups })`:
  - If `idpGroups` is defined (claim was present, no overage): check directly
    — write group ID present in `idpGroups` → `'write'`; else read group ID
    present → `'read'`; else → `'none'`. No network call needed.
  - If `idpGroups` is `undefined` (claim missing or overage): call Microsoft
    Graph `POST https://graph.microsoft.com/v1.0/me/checkMemberGroups` with
    `{ groupIds: [writeGroupId, readGroupId].filter(Boolean) }`, using
    `idpAccessToken` as the bearer token. The response's `value` array lists
    which of the candidate groups the user belongs to; derive `'write'` /
    `'read'` / `'none'` the same way as the claim-based path.
  - If neither `writeGroupId` nor `readGroupId` is configured, always
    returns `'none'` (fail closed) without making a network call.

### `auth.config.ts` changes

- Entra provider's `authorization.params.scope` gains `GroupMember.Read.All`
  alongside its existing scopes, so the delegated Graph fallback call is
  authorized.
- `jwt` callback, `microsoft-entra-id` branch: now also sets
  `token.idpAccessToken = account.access_token` (previously left unset —
  mirrors the GitHub branch).
- `jwt` callback, `microsoft-entra-id` branch: reads `profile.groups` into
  `token.idpGroups`. Overage detection: if `profile.groups` is absent, leave
  `token.idpGroups` undefined (covers both the overage case, signaled by
  `profile._claim_names?.groups`, and the case where no groups claim was
  configured at all — both need the same Graph fallback).
- `session` callback: copies `idpGroups` onto the session alongside the
  existing `idpAccessToken` / `idpLogin`.

### Auth-code plumbing

- `AuthCodeClaims` (in `src/lib/oauth/jwt.ts`) gains an optional
  `idpGroups?: string[]` field. `signAuthCode` / `verifyAuthCode` pass it
  through unchanged, same as the existing fields.
- `src/app/oauth/authorize/route.ts` sources `idpGroups` from the session when
  calling `signAuthCode`, alongside the existing `idpAccessToken` / `idpLogin`.

### `oauth/token/route.ts` wiring

After PKCE and redirect-URI validation succeed, before signing the access
token:

```ts
let access: AuthorizationLevel;
try {
  const authz = createAuthorizationProvider();
  access = await authz.checkAccess({
    idpAccessToken: claims.idpAccessToken,
    idpGroups: claims.idpGroups,
  });
} catch (err) {
  return NextResponse.json(
    { error: 'server_error', error_description: (err as Error).message },
    { status: 500 },
  );
}

if (access === 'none') {
  return NextResponse.json(
    {
      error: 'access_denied',
      error_description: 'Your account does not have read or write access to this vault.',
    },
    { status: 403 },
  );
}

const scope = access === 'write' ? 'mcp:read mcp:write' : 'mcp:read';
```

Both hardcoded `'mcp:read mcp:write'` literals (the signed token's `scope`
claim and the response body's `scope` field) are replaced with this computed
`scope` value.

### Tool-level enforcement in `mcp/tools.ts`

Port `requireWriteScope` from `origin/authorization`, generalizing its error
message to be provider-neutral:

```ts
function requireWriteScope(authInfo: unknown): { content: [{ type: 'text'; text: string }]; isError: true } | null {
  const scopes: string[] = (authInfo as { scopes?: string[] })?.scopes ?? [];
  if (!scopes.includes('mcp:write')) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'Insufficient permissions: this account has read-only access to this vault. Write access is required.',
        }),
      }],
      isError: true,
    };
  }
  return null;
}
```

Add `const permErr = requireWriteScope(ctx.authInfo); if (permErr) return permErr;`
as the first line of the 7 write-tool handlers: `create_document`,
`update_document`, `delete_document`, `publish_document`,
`stage_drift_suggestion`, `approve_suggestion`, `reject_suggestion`.

## Testing

- `src/lib/authorization/authorization-factory.test.ts` — mirrors
  `vault-sync-factory.test.ts` conventions: env var setup/teardown per `it`,
  `toBeInstanceOf` for provider selection, `toThrow` for missing config.
- `src/lib/authorization/providers/github-authorization-provider.test.ts` —
  mocked `fetch`, covering admin/push → write, pull → read, no permissions/404
  → none.
- `src/lib/authorization/providers/entra-authorization-provider.test.ts` —
  covers: `idpGroups` containing the write group ID, containing only the read
  group ID, containing neither; `idpGroups` undefined with a mocked
  `checkMemberGroups` fallback returning each of the three outcomes; no groups
  configured at all → `'none'` with no fetch call.
- `src/lib/auth.config.test.ts` — update the existing test asserting
  `idpAccessToken` is `undefined` for Entra (this flips: Entra now receives a
  token). Add cases for `idpGroups` being copied from `profile.groups`, and
  left undefined when the profile has no `groups` claim.
- `src/app/oauth/token/route.test.ts` (new) — covers: `'write'` access issues
  both scopes; `'read'` issues `mcp:read` only; `'none'` returns 403
  `access_denied`; a thrown provider-config error returns 500 `server_error`.
- `src/lib/mcp/tools.test.ts` — the shared `makeCtx` test helper currently
  omits `scopes` entirely; it needs a default of
  `scopes: ['mcp:read', 'mcp:write']` so existing write-tool tests keep passing
  once the guard is added. Add new cases per write tool (or a shared
  parameterized case) asserting `isError: true` with no `mcp:write` scope, and
  normal success when it's present.

## Acceptance criteria

- Every authenticated user no longer automatically receives `mcp:write`;
  scope is derived from `AuthorizationProvider.checkAccess`.
- Under `AUTH_PROVIDER=github`, access is derived from the user's permission
  on `AUTHZ_GITHUB_REPO`.
- Under `AUTH_PROVIDER=entra`, access is derived from membership in
  `AUTHZ_ENTRA_WRITE_GROUP_ID` / `AUTHZ_ENTRA_READ_GROUP_ID`, using the ID
  token's `groups` claim when available and falling back to Graph
  `checkMemberGroups` on overage or an absent claim.
- Users resolving to `'none'` are denied a token entirely (403), rather than
  silently receiving a read-only token.
- The 7 write MCP tools reject calls from tokens lacking `mcp:write` with a
  clear, provider-neutral error message.
- All new and existing tests pass; `pnpm build` and lint are clean.
