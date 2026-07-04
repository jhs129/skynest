# MCP Dual Authorization-Server Support (KAN-88) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Skynest's MCP endpoint accept a bearer token issued directly by a configured trusted Entra tenant, in addition to (never instead of) tokens it issues itself, so Copilot Studio's native on-behalf-of connector flow (KAN-38) can authenticate against Skynest without Skynest becoming lifestory/OC360-specific.

**Architecture:** `verifyMcpToken` inspects the token's `iss` claim before verification and routes to one of two independent branches: the existing self-issued-AS branch (unchanged), or a new external branch that resolves signing keys via OIDC discovery, verifies signature/issuer/audience, and — because externally-issued tokens never pass through Skynest's own `/oauth/token` issuance endpoint — calls `AuthorizationProvider.checkAccess()` itself using the token's own `groups` claim. The `.well-known/oauth-protected-resource` route becomes additive, listing the trusted issuer alongside Skynest's own origin only when configured.

**Tech Stack:** Next.js 15 (App Router), TypeScript, `jose` v6 (JWT verify, `createRemoteJWKSet`), Vitest.

## Global Constraints

- Both `MCP_TRUSTED_ISSUER` and `MCP_TRUSTED_AUDIENCE` unset → behavior must be byte-for-byte identical to today (self-issued-AS-only, PRM `authorization_servers` unchanged). Verify this explicitly in tests, not just by omission.
- No changes to `AuthorizationProvider` / `AuthorizationFactory` (`src/lib/authorization/**`) or their existing tests — the external branch is a new *caller* of `createAuthorizationProvider().checkAccess()`, not a new interface.
- No changes to the self-issued OAuth flow (`oauth/authorize`, `oauth/token`, `getPublicKey`/`getPrivateKey`).
- Fully generic: no lifestory/OC360-specific naming, branching, or config anywhere in this change.
- JWKS keys are resolved via OIDC discovery (`${MCP_TRUSTED_ISSUER}/.well-known/openid-configuration` → `jwks_uri`), never a hardcoded JWKS URL. The discovery document is cached ~5 minutes.
- Work happens directly on the already-checked-out `KAN-76` branch — do not create a new branch.
- Package manager is `pnpm`. After the final task, `pnpm build` and `pnpm lint` must both be clean.

---

### Task 1: `trusted-issuer.ts` — OIDC discovery and JWKS resolution

**Files:**
- Create: `src/lib/mcp/trusted-issuer.ts`
- Test: `src/lib/mcp/trusted-issuer.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (this is the foundation module).
- Produces:
  - `export async function resolveJwks(issuer: string): Promise<ReturnType<typeof createRemoteJWKSet>>` — returns a `jose` remote JWKS key-set resolver for the given issuer, resolving `jwks_uri` via OIDC discovery and caching the discovery document (specifically the resolved JWKS resolver instance, keyed by issuer) for 5 minutes.
  - `export function resetTrustedIssuerCache(): void` — clears the module-level discovery cache; test-only helper so tests don't leak cache state across `it` blocks.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mcp/trusted-issuer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockJwks = { fake: 'jwks-resolver' };
vi.mock('jose', async () => {
  const actual = await vi.importActual<typeof import('jose')>('jose');
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => mockJwks),
  };
});

const ISSUER = 'https://login.microsoftonline.com/test-tenant/v2.0';
const JWKS_URI = `${ISSUER}/discovery/v2.0/keys`;

function mockDiscoveryFetch() {
  return vi.fn(async (url: string | URL) => {
    expect(String(url)).toBe(`${ISSUER}/.well-known/openid-configuration`);
    return new Response(JSON.stringify({ jwks_uri: JWKS_URI }), { status: 200 });
  });
}

describe('resolveJwks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockDiscoveryFetch());
  });

  afterEach(async () => {
    const { resetTrustedIssuerCache } = await import('./trusted-issuer.js');
    resetTrustedIssuerCache();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fetches OIDC discovery and builds a remote JWKS from jwks_uri', async () => {
    const { createRemoteJWKSet } = await import('jose');
    const { resolveJwks } = await import('./trusted-issuer.js');

    const jwks = await resolveJwks(ISSUER);

    expect(fetch).toHaveBeenCalledWith(`${ISSUER}/.well-known/openid-configuration`);
    expect(createRemoteJWKSet).toHaveBeenCalledWith(new URL(JWKS_URI));
    expect(jwks).toBe(mockJwks);
  });

  it('caches the discovery result — a second call within the TTL does not re-fetch', async () => {
    const { resolveJwks } = await import('./trusted-issuer.js');

    await resolveJwks(ISSUER);
    await resolveJwks(ISSUER);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches discovery after the cache TTL expires', async () => {
    vi.useFakeTimers();
    const { resolveJwks } = await import('./trusted-issuer.js');

    await resolveJwks(ISSUER);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await resolveJwks(ISSUER);

    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws when the discovery document has no jwks_uri', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const { resolveJwks } = await import('./trusted-issuer.js');

    await expect(resolveJwks(ISSUER)).rejects.toThrow(/jwks_uri/);
  });

  it('throws when the discovery fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    const { resolveJwks } = await import('./trusted-issuer.js');

    await expect(resolveJwks(ISSUER)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/mcp/trusted-issuer.test.ts`
Expected: FAIL — `Cannot find module './trusted-issuer.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement `trusted-issuer.ts`**

Create `src/lib/mcp/trusted-issuer.ts`:

```ts
import { createRemoteJWKSet } from 'jose';

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedJwks {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  expiresAt: number;
}

let cache: Map<string, CachedJwks> = new Map();

export function resetTrustedIssuerCache(): void {
  cache = new Map();
}

async function discoverJwksUri(issuer: string): Promise<string> {
  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed for issuer ${issuer}: HTTP ${res.status}`);
  }
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) {
    throw new Error(`OIDC discovery document for issuer ${issuer} is missing jwks_uri`);
  }
  return doc.jwks_uri;
}

export async function resolveJwks(
  issuer: string,
): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const cached = cache.get(issuer);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.jwks;
  }

  const jwksUri = await discoverJwksUri(issuer);
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  cache.set(issuer, { jwks, expiresAt: now + DISCOVERY_CACHE_TTL_MS });
  return jwks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/mcp/trusted-issuer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/trusted-issuer.ts src/lib/mcp/trusted-issuer.test.ts
git commit -m "feat: add OIDC-discovery-based JWKS resolver for trusted issuers"
```

---

### Task 2: External-issuer verification branch in `verifyMcpToken`

**Files:**
- Modify: `src/lib/mcp/auth.ts`
- Test: `src/lib/mcp/auth.test.ts`

**Interfaces:**
- Consumes:
  - `resolveJwks(issuer: string): Promise<ReturnType<typeof createRemoteJWKSet>>` from Task 1 (`src/lib/mcp/trusted-issuer.ts`).
  - `createAuthorizationProvider(): AuthorizationProvider` from `src/lib/authorization/authorization-factory.ts` (existing).
  - `AuthorizationIdentity { idpAccessToken: string; idpGroups?: string[] }` and `AuthorizationLevel = 'write' | 'read' | 'none'` from `src/lib/authorization/authorization-provider.ts` (existing).
- Produces: `verifyMcpToken(token, resourceUrl)` gains external-issuer support; its exported signature (`(token: string | undefined, resourceUrl: string) => Promise<AuthInfo | undefined>`) is unchanged, so `src/app/api/mcp/[vaultId]/route.ts` needs no changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/mcp/auth.test.ts` (new `describe` block; keep all existing tests in the file untouched):

```ts
describe('verifyMcpToken with a trusted external issuer', () => {
  const ISSUER = 'https://login.microsoftonline.com/test-tenant/v2.0';
  const AUDIENCE = 'api://skynest-app-id';

  beforeEach(() => {
    vi.resetModules();
    process.env.MCP_TRUSTED_ISSUER = ISSUER;
    process.env.MCP_TRUSTED_AUDIENCE = AUDIENCE;
  });

  afterEach(() => {
    delete process.env.MCP_TRUSTED_ISSUER;
    delete process.env.MCP_TRUSTED_AUDIENCE;
    vi.clearAllMocks();
  });

  async function signExternalToken(
    privateKey: CryptoKey,
    claims: Record<string, unknown>,
    opts: { expiresIn?: string; audience?: string; issuer?: string } = {},
  ) {
    const { SignJWT } = await import('jose');
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(privateKey);
  }

  async function mockResolveJwks(publicKey: CryptoKey) {
    const { generateKeyPair: _unused } = await import('jose');
    void _unused;
    vi.doMock('./trusted-issuer.js', () => ({
      resolveJwks: vi.fn(async () => publicKey),
    }));
  }

  it('accepts a valid external token, calls checkAccess with the groups claim, and returns write scopes', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async (identity: { idpGroups?: string[] }) => {
          expect(identity.idpGroups).toEqual(['grp-write']);
          return 'write';
        }),
      }),
    }));

    const token = await signExternalToken(privateKey, {
      groups: ['grp-write'],
      preferred_username: 'staff@example.com',
      azp: 'connector-client-id',
    });

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');

    expect(result?.scopes).toEqual(['mcp:read', 'mcp:write']);
    expect(result?.clientId).toBe('connector-client-id');
    expect(result?.extra).toMatchObject({ userLogin: 'staff@example.com', userToken: token });
  });

  it('grants read-only scopes when checkAccess resolves "read"', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async () => 'read'),
      }),
    }));

    const token = await signExternalToken(privateKey, { groups: ['grp-read'] });
    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');

    expect(result?.scopes).toEqual(['mcp:read']);
  });

  it('rejects when checkAccess resolves "none"', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async () => 'none'),
      }),
    }));

    const token = await signExternalToken(privateKey, { groups: [] });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
  });

  it('calls checkAccess with idpGroups undefined when the groups claim is absent (overage case), and propagates a thrown provider error', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async (identity: { idpGroups?: string[] }) => {
          expect(identity.idpGroups).toBeUndefined();
          throw new Error('Graph call failed: wrong audience');
        }),
      }),
    }));

    const token = await signExternalToken(privateKey, {});
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow(
      /Graph call failed/,
    );
  });

  it('rejects a token whose aud does not match MCP_TRUSTED_AUDIENCE, before checkAccess is called', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    const token = await signExternalToken(privateKey, { groups: [] }, { audience: 'api://wrong' });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it('rejects an expired external token, before checkAccess is called', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    const token = await signExternalToken(privateKey, { groups: [] }, { expiresIn: '-1s' });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it('rejects a token signed by an untrusted key', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey: untrustedKey } = await generateKeyPair('RS256');
    const { publicKey: trustedPublicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(trustedPublicKey);
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    const token = await signExternalToken(untrustedKey, { groups: [] });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
    expect(checkAccess).not.toHaveBeenCalled();
  });
});

describe('verifyMcpToken routing when MCP_TRUSTED_ISSUER is unset', () => {
  it('still verifies self-issued tokens exactly as before (regression guard)', async () => {
    vi.resetModules();
    delete process.env.MCP_TRUSTED_ISSUER;
    delete process.env.MCP_TRUSTED_AUDIENCE;

    const { SignJWT, generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const { getPublicKey } = await import('@/lib/oauth/keys');
    vi.mocked(getPublicKey).mockResolvedValue(publicKey);

    const token = await new SignJWT({
      sub: 'user-123',
      client_id: 'mcpc_abc',
      scope: 'mcp:read',
      userToken: 'ghp_abc',
      userLogin: 'testuser',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/some-other-tenant/v2.0')
      .setAudience('https://example.com/api/mcp')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(privateKey);

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');
    expect(result?.extra).toMatchObject({ userToken: 'ghp_abc', userLogin: 'testuser' });
  });
});
```

Note: the top of the test file already mocks `@/lib/oauth/keys`; leave that mock as-is. `vi.doMock` (not `vi.mock`) is used within the new `it` blocks specifically because it must apply per-test after `vi.resetModules()`, and different tests need different mock implementations of `trusted-issuer.js` and the authorization factory.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/mcp/auth.test.ts`
Expected: FAIL — the new external-issuer tests fail because `verifyMcpToken` has no `iss`-routing logic yet (self-issued branch will reject the external tokens' shape/audience, or throw for the wrong reason).

- [ ] **Step 3: Implement the routing and external branch in `auth.ts`**

Replace the full contents of `src/lib/mcp/auth.ts`:

```ts
import { decodeJwt, jwtVerify } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getPublicKey } from '@/lib/oauth/keys';
import { resolveJwks } from './trusted-issuer';
import { createAuthorizationProvider } from '@/lib/authorization/authorization-factory';

export interface McpExtra {
  userToken: string; // IdP access token (repo-scoped, when the IdP is GitHub); empty under IdPs with no write-capable token
  userLogin: string; // IdP username/login used for attribution
  vaultId?: string;  // selected vault, derived from MCP server URL path; unset means "use CONTEXTNEST_DEFAULT_VAULT_ID"
}

// Escape hatch for testing non-auth-dependent functionality while an Entra admin
// consent grant is pending (KAN-32). Set MCP_AUTH_DISABLED=true to bypass bearer
// token verification entirely; unset (or any other value) to re-enable it.
const AUTH_DISABLED = process.env.MCP_AUTH_DISABLED === 'true';

export function isMcpAuthDisabled(): boolean {
  return AUTH_DISABLED;
}

function devBypassAuthInfo(): AuthInfo {
  return {
    token: 'mcp-auth-disabled',
    clientId: 'mcp-auth-disabled',
    scopes: ['mcp:read', 'mcp:write'],
    extra: {
      userToken: '',
      userLogin: process.env.MCP_AUTH_DISABLED_USER ?? 'auth-disabled@skynest',
    },
  };
}

async function verifySelfIssuedToken(token: string, resourceUrl: string): Promise<AuthInfo> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, {
    audience: resourceUrl,
    algorithms: ['RS256'],
  });

  const extra: Record<string, unknown> = {
    userToken: (payload['userToken'] as string) ?? '',
    userLogin: (payload['userLogin'] as string) ?? '',
  };
  return {
    token,
    clientId: payload['client_id'] as string,
    scopes: ((payload['scope'] as string) ?? '').split(' ').filter(Boolean),
    extra,
  };
}

async function verifyExternalToken(token: string): Promise<AuthInfo> {
  const issuer = process.env.MCP_TRUSTED_ISSUER as string;
  const audience = process.env.MCP_TRUSTED_AUDIENCE as string;

  const jwks = await resolveJwks(issuer);
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
    algorithms: ['RS256'],
  });

  const idpGroups = payload['groups'] as string[] | undefined;
  const authz = createAuthorizationProvider();
  const access = await authz.checkAccess({ idpAccessToken: token, idpGroups });

  if (access === 'none') {
    throw new Error('access_denied: caller has no read or write access to this vault');
  }

  const scopes = access === 'write' ? ['mcp:read', 'mcp:write'] : ['mcp:read'];
  const userLogin =
    (payload['preferred_username'] as string) ??
    (payload['upn'] as string) ??
    (payload['sub'] as string) ??
    '';
  const clientId = (payload['azp'] as string) ?? (payload['appid'] as string) ?? '';

  const extra: Record<string, unknown> = {
    userToken: token,
    userLogin,
  };
  return { token, clientId, scopes, extra };
}

export async function verifyMcpToken(
  token: string | undefined,
  resourceUrl: string,
): Promise<AuthInfo | undefined> {
  if (AUTH_DISABLED) return devBypassAuthInfo();
  if (!token) return undefined;

  const trustedIssuer = process.env.MCP_TRUSTED_ISSUER;
  if (trustedIssuer) {
    let iss: string | undefined;
    try {
      iss = decodeJwt(token).iss;
    } catch {
      iss = undefined;
    }
    if (iss === trustedIssuer) {
      return verifyExternalToken(token);
    }
  }

  return verifySelfIssuedToken(token, resourceUrl);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/mcp/auth.test.ts`
Expected: PASS (all existing tests + new external-issuer and routing tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/auth.ts src/lib/mcp/auth.test.ts
git commit -m "feat: verify trusted-Entra-issuer tokens alongside self-issued MCP tokens"
```

---

### Task 3: Additive `authorization_servers` in the PRM route

**Files:**
- Modify: `src/app/.well-known/oauth-protected-resource/route.ts`
- Test: `src/app/.well-known/oauth-protected-resource/route.test.ts`

**Interfaces:**
- Consumes: nothing new (reads `process.env.MCP_TRUSTED_ISSUER` directly, same pattern as `isMcpAuthDisabled()`'s env read).
- Produces: no exported change — this is a route handler, consumed only by HTTP clients.

- [ ] **Step 1: Write the failing test**

Add to `src/app/.well-known/oauth-protected-resource/route.test.ts` (new cases; keep existing tests untouched):

```ts
describe('GET with MCP_TRUSTED_ISSUER set', () => {
  const ISSUER = 'https://login.microsoftonline.com/test-tenant/v2.0';

  beforeEach(() => {
    process.env.MCP_TRUSTED_ISSUER = ISSUER;
  });

  afterEach(() => {
    delete process.env.MCP_TRUSTED_ISSUER;
  });

  it('includes both Skynest\'s own origin and the trusted issuer', async () => {
    const { GET } = await import('./route.js');
    const res = await GET();
    const body = await res.json();
    expect(body.authorization_servers).toEqual(
      expect.arrayContaining([ISSUER]),
    );
    expect(body.authorization_servers.length).toBe(2);
  });
});

describe('GET with MCP_TRUSTED_ISSUER unset', () => {
  it('lists only Skynest\'s own origin (unchanged behavior)', async () => {
    delete process.env.MCP_TRUSTED_ISSUER;
    const { GET } = await import('./route.js');
    const res = await GET();
    const body = await res.json();
    expect(body.authorization_servers.length).toBe(1);
  });
});
```

Check the top of the existing test file for how `resolveServerUrls` and `isMcpAuthDisabled` are already mocked, and reuse that same mock setup for these new cases (don't duplicate a second mock scheme).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/.well-known/oauth-protected-resource/route.test.ts`
Expected: FAIL — `authorization_servers.length` is `1` even with `MCP_TRUSTED_ISSUER` set.

- [ ] **Step 3: Implement the additive change**

In `src/app/.well-known/oauth-protected-resource/route.ts`, replace:

```ts
  const { baseUrl } = await resolveServerUrls();
  const base = baseUrl.origin;
  const resource = `${base}/api/mcp`;
  return NextResponse.json({
    resource,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
```

with:

```ts
  const { baseUrl } = await resolveServerUrls();
  const base = baseUrl.origin;
  const resource = `${base}/api/mcp`;
  const authorizationServers = [base];
  if (process.env.MCP_TRUSTED_ISSUER) {
    authorizationServers.push(process.env.MCP_TRUSTED_ISSUER);
  }
  return NextResponse.json({
    resource,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/.well-known/oauth-protected-resource/route.test.ts`
Expected: PASS (existing tests + 2 new cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/.well-known/oauth-protected-resource/route.ts src/app/.well-known/oauth-protected-resource/route.test.ts
git commit -m "feat: advertise trusted Entra issuer in PRM authorization_servers"
```

---

### Task 4: Env var documentation and full verification

**Files:**
- Modify: `README.md:163-168` (the existing `AUTH_PROVIDER=entra` env var block)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the new env vars to the README**

In `README.md`, immediately after the existing block:

```
AUTHZ_ENTRA_WRITE_GROUP_ID=<group-id>[,<group-id>...]  # members get mcp:read + mcp:write (comma-separated for multiple groups)
AUTHZ_ENTRA_READ_GROUP_ID=<group-id>[,<group-id>...]   # members get mcp:read only (comma-separated for multiple groups)
```

insert:

```

# Optional — also accept tokens issued directly by a trusted Entra tenant
# (e.g. from an MCP client's own on-behalf-of flow), alongside Skynest's own
# self-issued OAuth tokens. Leave both unset to keep today's self-issued-only
# behavior exactly as-is.
MCP_TRUSTED_ISSUER=https://login.microsoftonline.com/<tenant-guid>/v2.0
MCP_TRUSTED_AUDIENCE=api://<skynest-entra-app-id>   # from that app registration's "Expose an API" Identifier URI
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all suites, including the three touched in Tasks 1–3, plus every pre-existing test (in particular `src/lib/authorization/**` and `src/app/oauth/token/route.test.ts`, which must show zero changes in behavior).

- [ ] **Step 3: Run build and lint**

Run: `pnpm build`
Expected: build succeeds with no type errors.

Run: `pnpm lint`
Expected: no lint errors.

If either fails, fix the reported issue in the relevant file from Tasks 1–3 (not in README.md) and re-run both commands until clean.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document MCP_TRUSTED_ISSUER / MCP_TRUSTED_AUDIENCE env vars"
```

---

## Manual Verification (not automated, do after all 4 tasks)

Per the spec's acceptance criteria, once `ca-skynest-dev` has `MCP_TRUSTED_ISSUER` / `MCP_TRUSTED_AUDIENCE` configured (values from the `OC360-Skynest` app registration, per `scripts/03-app-registrations.ps1`), confirm the KAN-38 connector's native OBO handshake succeeds end-to-end against that environment. This depends on KAN-38's connector artifacts and deployed env config, and is out of scope for this plan's automated steps — flag it to the user as the remaining manual step before closing KAN-88.
