# MCP dual authorization-server support (KAN-88)

## Context

KAN-38's Copilot Studio custom connector uses the connector platform's native
"Enable on-behalf-of login" + Resource URL feature: Copilot Studio itself
performs the OBO exchange and hands the resulting Entra-issued access token
straight to Skynest's MCP endpoint as a bearer token. Skynest's MCP endpoint
(`src/lib/mcp/auth.ts`) currently only understands one kind of token — one it
minted itself via its own embedded OAuth 2.1 authorization server
(`oauth/authorize` → `oauth/token`, verified against `getPublicKey()`). It has
no path to accept a token issued directly by Entra, so the connector's native
OBO flow cannot be validated end-to-end until this lands.

This spec adds a second, independent verification path: Skynest's MCP
endpoint additionally trusts tokens issued by one configured external
authorization server (an Entra tenant), alongside its own. This is additive
and generic — Skynest gains no knowledge of Copilot Studio, connectors, or the
"life story" application. It is framed as "trust a second authorization
server," the same concept RFC 9728 already models by allowing
`authorization_servers` to be a list.

## Non-goals

- No changes to the existing self-issued authorization server
  (`oauth/authorize`, `oauth/token`, `getPublicKey()`/`getPrivateKey()`) —
  that flow is untouched and remains the default when the new env vars are
  unset.
- No changes to `AuthorizationProvider` / `AuthorizationFactory` or their
  `checkAccess(identity)` interface — the external branch is a new *caller*
  of that existing interface, not a new authorization mechanism. Group-based
  access decisions continue to work exactly as they do today.
- No lifestory/OC360-specific naming, config, or branching anywhere in this
  change — this must read as generic multi-tenant-IdP support, usable by any
  Skynest deployment.
- No per-vault configuration for the new env vars (they're global, matching
  the existing `MCP_AUTH_DISABLED` pattern) — out of scope until a deployment
  actually needs per-vault trusted issuers.
- No changes to the connector artifacts themselves (`connector/oc360-cs-connector/`)
  — that's KAN-38's scope, not this ticket's.

## Architecture

### New env vars

- `MCP_TRUSTED_ISSUER` — the Entra tenant's v2 issuer URL, e.g.
  `https://login.microsoftonline.com/{tenant-guid}/v2.0`.
- `MCP_TRUSTED_AUDIENCE` — the expected `aud` claim, e.g.
  `api://<Skynest-AppId>` (the Identifier URI configured on the
  `OC360-Skynest` app registration by `scripts/03-app-registrations.ps1`).

Both unset (the default today, and for any deployment that hasn't configured
this) → `verifyMcpToken` behaves byte-for-byte as it does now: self-issued-AS
verification only, external branch never entered.

**This is a distinct value from `resourceUrl`.** `route.ts` already computes
`resourceUrl = ${url.origin}/api/mcp` per-request and passes it to
`verifyMcpToken` as the audience for the *self-issued* branch. That stays
exactly as-is. `MCP_TRUSTED_AUDIENCE` is a separate, independently-configured
value used only by the new external branch — it will typically be an
`api://` App ID URI, a different shape from `resourceUrl`'s `https://` origin
form. The two are never compared against each other or unified into one
constant; they authenticate two different token issuers with two different
audience conventions.

### `iss`-based routing in `verifyMcpToken`

`src/lib/mcp/auth.ts` decodes the token's payload far enough to read `iss`
(without verifying signature yet — `jose`'s `decodeJwt` is sufficient, it's
inert local parsing) before choosing a verification path:

- `iss === MCP_TRUSTED_ISSUER` (and the env var is set) → new external-Entra
  branch, described below.
- Anything else (including when `MCP_TRUSTED_ISSUER` is unset) → existing
  self-issued-AS branch, unchanged: `jwtVerify` against `getPublicKey()`,
  `audience: resourceUrl`.

A malformed token that fails even `decodeJwt` falls through to the existing
self-issued branch, which will then reject it in `jwtVerify` exactly as today
(no new failure mode introduced).

### External-Entra verification branch

New module `src/lib/mcp/trusted-issuer.ts`:

- `resolveJwks(issuer: string)`: performs OIDC discovery —
  `GET ${issuer}/.well-known/openid-configuration` → reads `jwks_uri` — then
  returns a `jose` `createRemoteJWKSet(new URL(jwks_uri))` key-set resolver.
  The discovery document itself (specifically `jwks_uri`) is cached in module
  scope with a ~5 minute TTL, since it changes essentially never; the actual
  signing keys are cached by `createRemoteJWKSet`'s own built-in
  cooldown/cache behavior, so key rotation is picked up without a redeploy.
- `verifyExternalToken(token, issuer, audience)`: calls `jwtVerify(token,
  jwks, { issuer, audience, algorithms: ['RS256'] })`. `jose` enforces exact
  `aud` matching itself (rejects if the token's `aud` doesn't equal
  `audience`, whether `aud` is a string or array) — no bespoke comparison
  logic needed. Any failure (wrong audience, expired, untrusted issuer, bad
  signature, unreachable discovery endpoint) throws, same as the self-issued
  path's `jwtVerify` failures do today — `verifyMcpToken`'s caller already
  treats a thrown error as "reject the request."

**This branch is a new call site for `AuthorizationProvider.checkAccess()`,
not a reuse of an existing one.** Today, `checkAccess()` is only called once,
at token-*issuance* time in `oauth/token/route.ts` — it computes `scope` and
bakes it into the self-issued JWT's `scope` claim, which `verifyMcpToken`'s
self-issued branch later just reads back out. An externally-issued Entra
token never passes through Skynest's `/oauth/token` endpoint at all (that's
the entire point of the connector's native OBO flow), so nothing would ever
invoke `checkAccess()` for it unless the external branch calls it itself, on
every verified request:

```ts
const authz = createAuthorizationProvider();
const access = await authz.checkAccess({
  idpAccessToken: token,
  idpGroups: payload['groups'] as string[] | undefined,
});
if (access === 'none') throw new Error('access_denied');
const scopes = access === 'write' ? ['mcp:read', 'mcp:write'] : ['mcp:read'];
```

`idpGroups` comes directly from the verified token's own `groups` claim — the
`OC360-Skynest` app registration already sets `GroupMembershipClaims =
SecurityGroup` (`scripts/03-app-registrations.ps1`), so this is populated for
any user in ≤200 groups, the common case. **Known limitation:** if the claim
is absent due to Entra's groups-overage behavior, `EntraAuthorizationProvider`
falls back to calling Microsoft Graph's `checkMemberGroups` using
`idpAccessToken` as the bearer token — but the token available here has
`aud = api://<Skynest-AppId>` (from the connector's OBO exchange), not a
Graph-scoped audience, so it cannot be presented to Graph. In the overage
case, `checkAccess()` will attempt the Graph call and fail; this surfaces as
a `server_error` (fail-closed, not fail-open), which is acceptable for this
ticket — the pilot's staff headcount is far under the overage threshold, and
fixing it would require sourcing a second, Graph-scoped token through the
connector, which is out of scope here. Called out explicitly rather than
silently glossed over.

Once `access` is resolved, the external branch builds the same `AuthInfo`
shape the self-issued branch does. Entra tokens don't carry
`userToken`/`userLogin`/`client_id` in the self-issued convention — `userToken`
is set to the verified token itself (mirroring what the self-issued branch's
`extra.userToken` is used for: an IdP-scoped token attributable to the acting
user), `userLogin` is read from a standard Entra claim (`preferred_username`
or `upn`, falling back to `sub` if neither is present), and `clientId` is read
from the token's `azp` or `appid` claim (the two common Entra conventions for
"which client app requested this token"). `AuthorizationProvider` /
`AuthorizationFactory` themselves are completely unchanged — this is a new
caller, not a new interface.

### PRM route becomes additive

`src/app/.well-known/oauth-protected-resource/route.ts`'s
`authorization_servers` array:

```ts
const authorizationServers = [base];
if (process.env.MCP_TRUSTED_ISSUER) {
  authorizationServers.push(process.env.MCP_TRUSTED_ISSUER);
}
```

With `MCP_TRUSTED_ISSUER` unset, `authorization_servers` is `[base]` —
identical to today's output. With it set, the array lists both Skynest's own
origin and the trusted Entra issuer, per RFC 9728.

## Testing

- `src/lib/mcp/auth.test.ts` — existing tests are unchanged (they exercise
  the self-issued path with `MCP_TRUSTED_ISSUER` unset, which must keep
  behaving identically). New cases:
  - A token with `iss` matching `MCP_TRUSTED_ISSUER`, valid signature, and
    `aud === MCP_TRUSTED_AUDIENCE` → verified; asserts `checkAccess` was
    called with `idpGroups` taken from the token's `groups` claim, and that
    the returned `AuthInfo.scopes` matches the mocked `'write'`/`'read'`
    result (mock `createAuthorizationProvider` and `resolveJwks`/the remote
    JWKS fetch rather than hitting a real Entra tenant).
  - Same but `checkAccess` resolves `'none'` → rejected (no `AuthInfo`
    returned / request denied).
  - Same but the token has no `groups` claim (overage case) → `checkAccess`
    is still called (with `idpGroups: undefined`), and a thrown error from
    the mocked provider (simulating the Graph-audience mismatch) propagates
    as a rejection rather than being swallowed.
  - Wrong `aud` → rejected before `checkAccess` is ever called.
  - Expired token → rejected before `checkAccess` is ever called.
  - Signed by an untrusted key → rejected before `checkAccess` is ever
    called.
  - `iss` not matching `MCP_TRUSTED_ISSUER` and `MCP_TRUSTED_ISSUER` unset →
    routes to the self-issued branch (regression guard for the routing
    logic itself, not just the two branches in isolation).
- `src/lib/mcp/trusted-issuer.test.ts` (new) — OIDC discovery: fetches
  `jwks_uri` from a mocked discovery endpoint; caches it (second call within
  TTL doesn't re-fetch, mock call-count assertion); re-fetches after TTL
  expiry (can't use fake timers to fast-forward here in a way that also
  drives `createRemoteJWKSet`'s own cache — assert the discovery-doc cache
  behavior directly, independent of key caching).
- `src/app/.well-known/oauth-protected-resource/route.test.ts` — existing
  tests unchanged; new cases for `MCP_TRUSTED_ISSUER` set vs. unset, asserting
  the `authorization_servers` array contents in each case.
- No changes needed to `src/lib/authorization/**` tests — `checkAccess`'s
  own implementation and its existing tests are unaffected; only a new
  call site is added elsewhere.

## Acceptance criteria

- A valid Entra-issued token (correct `iss`, correct `aud` matching
  `MCP_TRUSTED_AUDIENCE`, valid signature, `groups` claim present) is
  accepted, `checkAccess()` is invoked with that token's own `groups` claim,
  and the resulting `AuthInfo.scopes` reflects `'write'`/`'read'`/denial
  accordingly.
- With `MCP_TRUSTED_ISSUER`/`MCP_TRUSTED_AUDIENCE` unset, behavior is
  byte-for-byte identical to today: only self-issued tokens verify, PRM
  response unchanged.
- Wrong audience, expired token, untrusted issuer, or bad signature on an
  external-issuer token is rejected before `checkAccess()` is ever called,
  the same way `jwtVerify` failures are rejected today (thrown error, no
  silent pass-through).
- `checkAccess()` resolving `'none'` for an otherwise-valid external token
  results in a denied request, not a token with empty scopes.
- The groups-overage limitation (no `groups` claim → `checkAccess()`'s Graph
  fallback fails because the available token is Skynest-audienced, not
  Graph-audienced) is documented and fails closed, not silently.
- JWKS signing keys are resolved via OIDC discovery (`jwks_uri`), not a
  hardcoded URL; the discovery document is cached (~5 min) rather than
  fetched per request.
- `/.well-known/oauth-protected-resource` lists both authorization servers
  when `MCP_TRUSTED_ISSUER` is set, and only Skynest's own origin when unset.
- `AuthorizationProvider` / `AuthorizationFactory` and their existing tests
  are unchanged.
- All new and existing tests pass; `pnpm build` and lint are clean.
- Manual verification: the KAN-38 connector's native OBO handshake against
  `ca-skynest-dev` succeeds once `MCP_TRUSTED_ISSUER`/`MCP_TRUSTED_AUDIENCE`
  are configured there.
