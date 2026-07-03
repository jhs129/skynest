# Authorization Scope Gating (KAN-34 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "every authenticated user gets `mcp:read mcp:write`" behavior with real authorization: a pluggable `AuthorizationProvider` resolves each user to `write` / `read` / `none` (via GitHub repo permissions or Entra security group membership), `oauth/token/route.ts` issues scope accordingly and denies `none`, and the 7 write MCP tools reject calls lacking `mcp:write`.

**Architecture:** A new `src/lib/authorization/` module (interface + factory + two providers) mirrors the existing `src/lib/vault/sync/` pluggable-provider pattern. The Entra ID token/session pipeline is extended to carry an access token and group-membership claim through to the OAuth auth code. `oauth/token/route.ts` calls the provider before signing the access token; `mcp/tools.ts` gets a `requireWriteScope` guard ported onto its 7 mutating tool handlers.

**Tech Stack:** Next.js App Router route handlers, NextAuth (GitHub / Microsoft Entra ID providers), `jose` for JWTs, Vitest for tests, pnpm.

## Global Constraints

- Package manager is pnpm — use `pnpm test`, `pnpm build`, `pnpm lint` (never npm/yarn).
- No per-vault authorization config — env vars (`AUTHZ_GITHUB_REPO`, `AUTHZ_ENTRA_WRITE_GROUP_ID`, `AUTHZ_ENTRA_READ_GROUP_ID`) are global, unlike vault-sync's per-vault suffixing.
- No changes to `oauth/authorize/route.ts`'s core PKCE/redirect flow beyond passing `idpGroups` through.
- No UI/consent-screen changes.
- No changes to the Azure Blob vault-sync provider or its factory.
- Do not bump app versions.
- After every task, run `pnpm build`, `pnpm lint`, and `pnpm test` and fix any errors before moving on (per repo-wide convention already followed in this codebase).
- Design spec of record: `docs/superpowers/specs/2026-07-02-authorization-scope-gating-design.md`. If any task here appears to conflict with it, the spec wins — stop and flag it.

---

### Task 1: `AuthorizationProvider` interface + `GitHubAuthorizationProvider`

**Files:**
- Create: `src/lib/authorization/authorization-provider.ts`
- Create: `src/lib/authorization/providers/github-authorization-provider.ts`
- Test: `src/lib/authorization/providers/github-authorization-provider.test.ts`

**Interfaces:**
- Produces: `AuthorizationLevel = 'write' | 'read' | 'none'`; `AuthorizationIdentity { idpAccessToken: string; idpGroups?: string[] }`; `AuthorizationProvider { checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel> }`; `GitHubAuthorizationProvider` (constructor `{ repo: string }`, implements `AuthorizationProvider`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/authorization/providers/github-authorization-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAuthorizationProvider } from './github-authorization-provider.js';

const fetchMock = vi.fn();
global.fetch = fetchMock;

const provider = new GitHubAuthorizationProvider({ repo: 'owner/testrepo' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubAuthorizationProvider.checkAccess', () => {
  it('returns write when the user has admin permission', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: true, push: false, pull: true } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('write');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/testrepo',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_test' }),
      }),
    );
  });

  it('returns write when the user has push permission', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: false, push: true, pull: true } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('write');
  });

  it('returns read when the user only has pull permission', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: false, push: false, pull: true } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('read');
  });

  it('returns none when permissions are all false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: false, push: false, pull: false } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });

  it('returns none when the response has no permissions field', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });

  it('returns none on a 404 (no repo access)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });

  it('returns none on a 403 (rate-limited or blocked)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/authorization/providers/github-authorization-provider.test.ts`
Expected: FAIL — cannot find module `./github-authorization-provider.js`

- [ ] **Step 3: Write the interface file**

Create `src/lib/authorization/authorization-provider.ts`:

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

- [ ] **Step 4: Write the GitHub provider**

Create `src/lib/authorization/providers/github-authorization-provider.ts`:

```ts
import type {
  AuthorizationLevel,
  AuthorizationProvider,
  AuthorizationIdentity,
} from '../authorization-provider.js';

export interface GitHubAuthorizationProviderConfig {
  repo: string;
}

export class GitHubAuthorizationProvider implements AuthorizationProvider {
  constructor(private readonly config: GitHubAuthorizationProviderConfig) {}

  async checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel> {
    const res = await fetch(`https://api.github.com/repos/${this.config.repo}`, {
      headers: {
        Authorization: `Bearer ${identity.idpAccessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) return 'none';

    const data = (await res.json()) as {
      permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
    };

    const perms = data.permissions;
    if (!perms) return 'none';
    if (perms.admin || perms.push) return 'write';
    if (perms.pull) return 'read';
    return 'none';
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/authorization/providers/github-authorization-provider.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/authorization/authorization-provider.ts src/lib/authorization/providers/github-authorization-provider.ts src/lib/authorization/providers/github-authorization-provider.test.ts
git commit -m "feat: add AuthorizationProvider interface and GitHubAuthorizationProvider"
```

---

### Task 2: `EntraAuthorizationProvider`

**Files:**
- Create: `src/lib/authorization/providers/entra-authorization-provider.ts`
- Test: `src/lib/authorization/providers/entra-authorization-provider.test.ts`

**Interfaces:**
- Consumes: `AuthorizationLevel`, `AuthorizationProvider`, `AuthorizationIdentity` from `../authorization-provider.js` (Task 1).
- Produces: `EntraAuthorizationProvider` (constructor `{ writeGroupId?: string; readGroupId?: string }`, implements `AuthorizationProvider`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/authorization/providers/entra-authorization-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntraAuthorizationProvider } from './entra-authorization-provider.js';

const fetchMock = vi.fn();
global.fetch = fetchMock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EntraAuthorizationProvider.checkAccess — claim-based (idpGroups present)', () => {
  const provider = new EntraAuthorizationProvider({
    writeGroupId: 'write-group-id',
    readGroupId: 'read-group-id',
  });

  it('returns write when idpGroups contains the write group', async () => {
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['write-group-id'] });
    expect(access).toBe('write');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns read when idpGroups contains only the read group', async () => {
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['read-group-id'] });
    expect(access).toBe('read');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns none when idpGroups contains neither group', async () => {
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['other-group'] });
    expect(access).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('EntraAuthorizationProvider.checkAccess — Graph fallback (idpGroups undefined)', () => {
  const provider = new EntraAuthorizationProvider({
    writeGroupId: 'write-group-id',
    readGroupId: 'read-group-id',
  });

  it('calls checkMemberGroups and returns write when it lists the write group', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: ['write-group-id'] }) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('write');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/checkMemberGroups',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ groupIds: ['write-group-id', 'read-group-id'] }),
      }),
    );
  });

  it('returns read when checkMemberGroups lists only the read group', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: ['read-group-id'] }) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('read');
  });

  it('returns none when checkMemberGroups lists neither group', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('none');
  });

  it('returns none when the Graph call fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('none');
  });
});

describe('EntraAuthorizationProvider.checkAccess — no groups configured', () => {
  it('fails closed to none without calling fetch', async () => {
    const provider = new EntraAuthorizationProvider({});
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['anything'] });
    expect(access).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/authorization/providers/entra-authorization-provider.test.ts`
Expected: FAIL — cannot find module `./entra-authorization-provider.js`

- [ ] **Step 3: Write the Entra provider**

Create `src/lib/authorization/providers/entra-authorization-provider.ts`:

```ts
import type {
  AuthorizationLevel,
  AuthorizationProvider,
  AuthorizationIdentity,
} from '../authorization-provider.js';

export interface EntraAuthorizationProviderConfig {
  writeGroupId?: string;
  readGroupId?: string;
}

export class EntraAuthorizationProvider implements AuthorizationProvider {
  constructor(private readonly config: EntraAuthorizationProviderConfig) {}

  async checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel> {
    const { writeGroupId, readGroupId } = this.config;
    if (!writeGroupId && !readGroupId) return 'none';

    const groups = identity.idpGroups ?? (await this.fetchGroupMemberships(identity.idpAccessToken));
    return this.levelFromGroups(groups);
  }

  private levelFromGroups(groups: string[]): AuthorizationLevel {
    const { writeGroupId, readGroupId } = this.config;
    if (writeGroupId && groups.includes(writeGroupId)) return 'write';
    if (readGroupId && groups.includes(readGroupId)) return 'read';
    return 'none';
  }

  private async fetchGroupMemberships(idpAccessToken: string): Promise<string[]> {
    const groupIds = [this.config.writeGroupId, this.config.readGroupId].filter(
      (id): id is string => Boolean(id),
    );
    const res = await fetch('https://graph.microsoft.com/v1.0/me/checkMemberGroups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ groupIds }),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as { value?: string[] };
    return data.value ?? [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/authorization/providers/entra-authorization-provider.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/authorization/providers/entra-authorization-provider.ts src/lib/authorization/providers/entra-authorization-provider.test.ts
git commit -m "feat: add EntraAuthorizationProvider with claim and Graph-fallback checks"
```

---

### Task 3: `authorization-factory.ts`

**Files:**
- Create: `src/lib/authorization/authorization-factory.ts`
- Test: `src/lib/authorization/authorization-factory.test.ts`

**Interfaces:**
- Consumes: `AuthorizationProvider` (Task 1), `GitHubAuthorizationProvider` (Task 1), `EntraAuthorizationProvider` (Task 2).
- Produces: `createAuthorizationProvider(): AuthorizationProvider`, reading `process.env.AUTH_PROVIDER` (`github` default | `entra`), `process.env.AUTHZ_GITHUB_REPO`, `process.env.AUTHZ_ENTRA_WRITE_GROUP_ID`, `process.env.AUTHZ_ENTRA_READ_GROUP_ID`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/authorization/authorization-factory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthorizationProvider } from './authorization-factory.js';
import { GitHubAuthorizationProvider } from './providers/github-authorization-provider.js';
import { EntraAuthorizationProvider } from './providers/entra-authorization-provider.js';

describe('createAuthorizationProvider', () => {
  beforeEach(() => {
    delete process.env.AUTH_PROVIDER;
    delete process.env.AUTHZ_GITHUB_REPO;
    delete process.env.AUTHZ_ENTRA_WRITE_GROUP_ID;
    delete process.env.AUTHZ_ENTRA_READ_GROUP_ID;
  });

  it('returns a GitHubAuthorizationProvider when AUTH_PROVIDER is unset', () => {
    process.env.AUTHZ_GITHUB_REPO = 'owner/repo';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(GitHubAuthorizationProvider);
  });

  it('returns a GitHubAuthorizationProvider when AUTH_PROVIDER=github', () => {
    process.env.AUTH_PROVIDER = 'github';
    process.env.AUTHZ_GITHUB_REPO = 'owner/repo';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(GitHubAuthorizationProvider);
  });

  it('throws when AUTH_PROVIDER=github (or unset) and AUTHZ_GITHUB_REPO is missing', () => {
    expect(() => createAuthorizationProvider()).toThrow(
      /AUTHZ_GITHUB_REPO env var is required when AUTH_PROVIDER=github/,
    );
  });

  it('returns an EntraAuthorizationProvider when AUTH_PROVIDER=entra', () => {
    process.env.AUTH_PROVIDER = 'entra';
    process.env.AUTHZ_ENTRA_WRITE_GROUP_ID = 'write-group-id';
    process.env.AUTHZ_ENTRA_READ_GROUP_ID = 'read-group-id';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(EntraAuthorizationProvider);
  });

  it('returns an EntraAuthorizationProvider under AUTH_PROVIDER=entra even with no group env vars set (the provider itself fails closed, not the factory)', () => {
    process.env.AUTH_PROVIDER = 'entra';
    const provider = createAuthorizationProvider();
    expect(provider).toBeInstanceOf(EntraAuthorizationProvider);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/authorization/authorization-factory.test.ts`
Expected: FAIL — cannot find module `./authorization-factory.js`

- [ ] **Step 3: Write the factory**

Create `src/lib/authorization/authorization-factory.ts`:

```ts
import type { AuthorizationProvider } from './authorization-provider.js';
import { GitHubAuthorizationProvider } from './providers/github-authorization-provider.js';
import { EntraAuthorizationProvider } from './providers/entra-authorization-provider.js';

export function createAuthorizationProvider(): AuthorizationProvider {
  const authProvider = process.env.AUTH_PROVIDER ?? 'github';

  if (authProvider === 'entra') {
    return new EntraAuthorizationProvider({
      writeGroupId: process.env.AUTHZ_ENTRA_WRITE_GROUP_ID,
      readGroupId: process.env.AUTHZ_ENTRA_READ_GROUP_ID,
    });
  }

  const repo = process.env.AUTHZ_GITHUB_REPO;
  if (!repo) {
    throw new Error('AUTHZ_GITHUB_REPO env var is required when AUTH_PROVIDER=github');
  }
  return new GitHubAuthorizationProvider({ repo });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/authorization/authorization-factory.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/authorization/authorization-factory.ts src/lib/authorization/authorization-factory.test.ts
git commit -m "feat: add createAuthorizationProvider factory"
```

---

### Task 4: `auth.config.ts` — carry Entra access token and group claim

**Files:**
- Modify: `src/lib/auth.config.ts`
- Modify: `src/lib/auth.config.test.ts`

**Interfaces:**
- No new exports. `authConfig.callbacks.jwt` now also sets `token.idpAccessToken` and `token.idpGroups` for the `microsoft-entra-id` branch. `authConfig.callbacks.session` now also copies `idpGroups` onto the session.

- [ ] **Step 1: Update the test file first (will fail against current code)**

In `src/lib/auth.config.test.ts`, replace the test `'jwt callback leaves idpAccessToken unset for Entra ID and sources idpLogin from preferred_username'` and add new cases. Replace this block:

```ts
  it('jwt callback leaves idpAccessToken unset for Entra ID and sources idpLogin from preferred_username', async () => {
    const authConfig = await loadAuthConfig();
    const token = await authConfig.callbacks!.jwt!({
      token: { name: 'Fallback Name' },
      account: { provider: 'microsoft-entra-id' } as never,
      profile: { preferred_username: 'jane@contoso.com', email: 'jane@other.com' } as never,
    } as never);
    expect(token.idpAccessToken).toBeUndefined();
    expect(token.idpLogin).toBe('jane@contoso.com');
  });
```

with:

```ts
  it('jwt callback carries an Entra ID access token and sources idpLogin from preferred_username', async () => {
    const authConfig = await loadAuthConfig();
    const token = await authConfig.callbacks!.jwt!({
      token: { name: 'Fallback Name' },
      account: { provider: 'microsoft-entra-id', access_token: 'entra_at_abc' } as never,
      profile: { preferred_username: 'jane@contoso.com', email: 'jane@other.com' } as never,
    } as never);
    expect(token.idpAccessToken).toBe('entra_at_abc');
    expect(token.idpLogin).toBe('jane@contoso.com');
  });

  it('jwt callback copies profile.groups into idpGroups when present', async () => {
    const authConfig = await loadAuthConfig();
    const token = await authConfig.callbacks!.jwt!({
      token: { name: 'Fallback Name' },
      account: { provider: 'microsoft-entra-id', access_token: 'entra_at_abc' } as never,
      profile: { preferred_username: 'jane@contoso.com', groups: ['group-a', 'group-b'] } as never,
    } as never);
    expect(token.idpGroups).toEqual(['group-a', 'group-b']);
  });

  it('jwt callback leaves idpGroups undefined when the profile has no groups claim', async () => {
    const authConfig = await loadAuthConfig();
    const token = await authConfig.callbacks!.jwt!({
      token: { name: 'Fallback Name' },
      account: { provider: 'microsoft-entra-id', access_token: 'entra_at_abc' } as never,
      profile: { preferred_username: 'jane@contoso.com' } as never,
    } as never);
    expect(token.idpGroups).toBeUndefined();
  });
```

Then replace the session-callback test:

```ts
  it('session callback copies idpAccessToken/idpLogin from the token onto the session', async () => {
    const authConfig = await loadAuthConfig();
    const session = await authConfig.callbacks!.session!({
      session: { user: {}, expires: '' } as never,
      token: { idpAccessToken: 'ghp_abc', idpLogin: 'octocat' } as never,
    } as never);
    expect((session as { idpAccessToken?: string }).idpAccessToken).toBe('ghp_abc');
    expect((session as { idpLogin?: string }).idpLogin).toBe('octocat');
  });
```

with:

```ts
  it('session callback copies idpAccessToken/idpLogin/idpGroups from the token onto the session', async () => {
    const authConfig = await loadAuthConfig();
    const session = await authConfig.callbacks!.session!({
      session: { user: {}, expires: '' } as never,
      token: { idpAccessToken: 'ghp_abc', idpLogin: 'octocat', idpGroups: ['group-a'] } as never,
    } as never);
    expect((session as { idpAccessToken?: string }).idpAccessToken).toBe('ghp_abc');
    expect((session as { idpLogin?: string }).idpLogin).toBe('octocat');
    expect((session as { idpGroups?: string[] }).idpGroups).toEqual(['group-a']);
  });
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `pnpm vitest run src/lib/auth.config.test.ts`
Expected: FAIL — `idpAccessToken` is `undefined` (not `'entra_at_abc'`); `idpGroups` is `undefined` on the first new test; session test's `idpGroups` assertion fails (`undefined` !== `['group-a']`)

- [ ] **Step 3: Update `auth.config.ts`**

In `src/lib/auth.config.ts`, add the Graph scope to the Entra provider. Replace:

```ts
    return [
      MicrosoftEntraID({
        clientId: process.env.ENTRA_CLIENT_ID!,
        clientSecret: process.env.ENTRA_CLIENT_SECRET!,
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      }),
    ];
```

with:

```ts
    return [
      MicrosoftEntraID({
        clientId: process.env.ENTRA_CLIENT_ID!,
        clientSecret: process.env.ENTRA_CLIENT_SECRET!,
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        authorization: {
          params: { scope: 'openid profile email GroupMember.Read.All' },
        },
      }),
    ];
```

Then replace the `jwt` and `session` callbacks. Replace:

```ts
    jwt({ token, account, profile }) {
      if (account?.provider === 'github' && account.access_token) {
        // The repo-scoped GitHub token doubles as the git-write credential
        // GitHubVaultSyncProvider commits with — see idpAccessToken usage
        // downstream in src/app/oauth/token/route.ts.
        token.idpAccessToken = account.access_token;
        token.idpLogin = (account as { login?: string }).login ?? token.name;
      } else if (account?.provider === 'microsoft-entra-id') {
        // No git-write-capable token exists under Entra ID (and GitHub sync
        // is rejected under this mode anyway); only carry an attribution name.
        const entraProfile = profile as { preferred_username?: string; email?: string } | undefined;
        token.idpLogin = entraProfile?.preferred_username ?? entraProfile?.email ?? token.name;
      }
      return token;
    },
    session({ session, token }) {
      (session as typeof session & { idpAccessToken?: string; idpLogin?: string }).idpAccessToken =
        token.idpAccessToken as string | undefined;
      (session as typeof session & { idpAccessToken?: string; idpLogin?: string }).idpLogin =
        token.idpLogin as string | undefined;
      return session;
    },
```

with:

```ts
    jwt({ token, account, profile }) {
      if (account?.provider === 'github' && account.access_token) {
        // The repo-scoped GitHub token doubles as the git-write credential
        // GitHubVaultSyncProvider commits with — see idpAccessToken usage
        // downstream in src/app/oauth/token/route.ts.
        token.idpAccessToken = account.access_token;
        token.idpLogin = (account as { login?: string }).login ?? token.name;
      } else if (account?.provider === 'microsoft-entra-id') {
        // The access token is used against Microsoft Graph's checkMemberGroups
        // as a fallback when the groups claim is absent (see EntraAuthorizationProvider).
        token.idpAccessToken = account.access_token;
        const entraProfile = profile as
          | { preferred_username?: string; email?: string; groups?: string[] }
          | undefined;
        token.idpLogin = entraProfile?.preferred_username ?? entraProfile?.email ?? token.name;
        token.idpGroups = entraProfile?.groups;
      }
      return token;
    },
    session({ session, token }) {
      const s = session as typeof session & {
        idpAccessToken?: string;
        idpLogin?: string;
        idpGroups?: string[];
      };
      s.idpAccessToken = token.idpAccessToken as string | undefined;
      s.idpLogin = token.idpLogin as string | undefined;
      s.idpGroups = token.idpGroups as string[] | undefined;
      return session;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/auth.config.test.ts`
Expected: PASS (all tests, including the 3 GitHub-provider-selection tests which are unaffected)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.config.ts src/lib/auth.config.test.ts
git commit -m "feat: carry Entra ID access token and groups claim through auth session"
```

---

### Task 5: `AuthCodeClaims.idpGroups` plumbing

**Files:**
- Modify: `src/lib/oauth/jwt.ts`
- Modify: `src/app/oauth/authorize/route.ts`

**Interfaces:**
- Consumes: session's `idpGroups` (Task 4).
- Produces: `AuthCodeClaims.idpGroups?: string[]`, passed through unchanged by `signAuthCode`/`verifyAuthCode` (both already spread/cast claims generically, so no other change is needed there). This field is consumed by Task 6's `oauth/token/route.ts` wiring.

No dedicated unit test exists today for `jwt.ts` or `authorize/route.ts` (verified: no `jwt.test.ts` or `authorize/route.test.ts` in the repo) — this is a small, type-level plumbing change with no independent observable behavior. It's exercised end-to-end by Task 6's `oauth/token/route.test.ts`, which asserts `idpGroups` reaches `AuthorizationProvider.checkAccess`. Do not skip Task 6's coverage of this field.

- [ ] **Step 1: Add the field to `AuthCodeClaims`**

In `src/lib/oauth/jwt.ts`, replace:

```ts
interface AuthCodeClaims {
  sub: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  idpAccessToken: string;
  idpLogin: string;
}
```

with:

```ts
interface AuthCodeClaims {
  sub: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  idpAccessToken: string;
  idpLogin: string;
  idpGroups?: string[];
}
```

- [ ] **Step 2: Pass `idpGroups` through in `authorize/route.ts`**

In `src/app/oauth/authorize/route.ts`, replace:

```ts
  const code = await signAuthCode({
    sub: session.user.email!,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    idpAccessToken:
      (session as { idpAccessToken?: string }).idpAccessToken ?? '',
    idpLogin:
      (session as { idpLogin?: string }).idpLogin ?? session.user.name ?? '',
  });
```

with:

```ts
  const code = await signAuthCode({
    sub: session.user.email!,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    idpAccessToken:
      (session as { idpAccessToken?: string }).idpAccessToken ?? '',
    idpLogin:
      (session as { idpLogin?: string }).idpLogin ?? session.user.name ?? '',
    idpGroups: (session as { idpGroups?: string[] }).idpGroups,
  });
```

- [ ] **Step 3: Verify the build type-checks**

Run: `pnpm build`
Expected: succeeds with no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/oauth/jwt.ts src/app/oauth/authorize/route.ts
git commit -m "feat: plumb idpGroups through the OAuth auth code"
```

---

### Task 6: `oauth/token/route.ts` wiring — compute scope from `AuthorizationProvider`

**Files:**
- Modify: `src/app/oauth/token/route.ts`
- Test: `src/app/oauth/token/route.test.ts` (new)

**Interfaces:**
- Consumes: `createAuthorizationProvider` (Task 3), `AuthCodeClaims.idpGroups` (Task 5).
- Produces: the route now returns `scope: 'mcp:read mcp:write'` for `'write'` access, `scope: 'mcp:read'` for `'read'` access, HTTP 403 `{ error: 'access_denied' }` for `'none'`, and HTTP 500 `{ error: 'server_error' }` when `createAuthorizationProvider()`/`checkAccess` throws.

- [ ] **Step 1: Write the failing test**

Create `src/app/oauth/token/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/oauth/jwt', () => ({
  verifyAuthCode: vi.fn(),
  signAccessToken: vi.fn(),
}));

vi.mock('@/lib/oauth/pkce', () => ({
  verifyPkce: vi.fn(),
}));

vi.mock('@/lib/oauth/urls', () => ({
  resolveServerUrls: vi.fn(),
}));

vi.mock('@/lib/authorization/authorization-factory', () => ({
  createAuthorizationProvider: vi.fn(),
}));

import { verifyAuthCode, signAccessToken } from '@/lib/oauth/jwt';
import { verifyPkce } from '@/lib/oauth/pkce';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { createAuthorizationProvider } from '@/lib/authorization/authorization-factory';
import { POST } from './route';

const VALID_CLAIMS = {
  sub: 'user@example.com',
  clientId: 'mcpc_abc',
  redirectUri: 'http://localhost:8765/callback',
  codeChallenge: 'challenge-value',
  idpAccessToken: 'idp-token',
  idpLogin: 'octocat',
};

const VALID_FIELDS = {
  grant_type: 'authorization_code',
  code: 'auth-code-value',
  code_verifier: 'a'.repeat(43),
  redirect_uri: 'http://localhost:8765/callback',
};

function makeRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest('http://localhost/oauth/token', { method: 'POST', body: formData });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyAuthCode).mockResolvedValue(VALID_CLAIMS);
  vi.mocked(verifyPkce).mockReturnValue(true);
  vi.mocked(resolveServerUrls).mockResolvedValue({
    baseUrl: new URL('http://localhost'),
    issuer: new URL('http://localhost'),
    resourceUrl: new URL('http://localhost'),
  });
  vi.mocked(signAccessToken).mockResolvedValue({ token: 'signed-jwt', expiresIn: 604800 });
});

describe('POST /oauth/token', () => {
  it('returns invalid_request when required fields are missing', async () => {
    const res = await POST(makeRequest({ grant_type: 'authorization_code' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns invalid_grant when PKCE verification fails, without checking authorization', async () => {
    vi.mocked(verifyPkce).mockReturnValue(false);
    const res = await POST(makeRequest(VALID_FIELDS));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
    expect(createAuthorizationProvider).not.toHaveBeenCalled();
  });

  it('issues both scopes when the authorization provider grants write access', async () => {
    vi.mocked(createAuthorizationProvider).mockReturnValue({
      checkAccess: vi.fn().mockResolvedValue('write'),
    } as never);

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope).toBe('mcp:read mcp:write');
    expect(signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mcp:read mcp:write' }),
    );
  });

  it('issues read-only scope when the authorization provider grants read access', async () => {
    vi.mocked(createAuthorizationProvider).mockReturnValue({
      checkAccess: vi.fn().mockResolvedValue('read'),
    } as never);

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope).toBe('mcp:read');
    expect(signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mcp:read' }),
    );
  });

  it('returns 403 access_denied when the authorization provider grants no access', async () => {
    vi.mocked(createAuthorizationProvider).mockReturnValue({
      checkAccess: vi.fn().mockResolvedValue('none'),
    } as never);

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('access_denied');
    expect(signAccessToken).not.toHaveBeenCalled();
  });

  it('returns 500 server_error when the authorization provider is misconfigured', async () => {
    vi.mocked(createAuthorizationProvider).mockImplementation(() => {
      throw new Error('AUTHZ_GITHUB_REPO env var is required when AUTH_PROVIDER=github');
    });

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('server_error');
    expect(body.error_description).toMatch(/AUTHZ_GITHUB_REPO/);
  });

  it('passes idpAccessToken and idpGroups from the auth code claims to checkAccess', async () => {
    vi.mocked(verifyAuthCode).mockResolvedValue({ ...VALID_CLAIMS, idpGroups: ['group-a'] });
    const checkAccess = vi.fn().mockResolvedValue('write');
    vi.mocked(createAuthorizationProvider).mockReturnValue({ checkAccess } as never);

    await POST(makeRequest(VALID_FIELDS));

    expect(checkAccess).toHaveBeenCalledWith({ idpAccessToken: 'idp-token', idpGroups: ['group-a'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/oauth/token/route.test.ts`
Expected: FAIL — the write/read/403/500/idpGroups tests fail because the current route always issues `'mcp:read mcp:write'` and never calls `createAuthorizationProvider`

- [ ] **Step 3: Update the route**

Replace the full contents of `src/app/oauth/token/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthCode, signAccessToken } from '@/lib/oauth/jwt';
import { verifyPkce } from '@/lib/oauth/pkce';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { ACCESS_TOKEN_TTL_SECONDS } from '@/lib/oauth/config';
import { createAuthorizationProvider } from '@/lib/authorization/authorization-factory';

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const grantType = body.get('grant_type');

  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  const code = body.get('code') as string | null;
  const codeVerifier = body.get('code_verifier') as string | null;
  const redirectUri = body.get('redirect_uri') as string | null;

  if (!code || !codeVerifier || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  let claims;
  try {
    claims = await verifyAuthCode(code);
  } catch {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  const pkceValid = verifyPkce({
    codeVerifier,
    codeChallenge: claims.codeChallenge,
    codeChallengeMethod: 'S256',
  });
  if (!pkceValid) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  if (claims.redirectUri !== redirectUri) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  let scope: string;
  try {
    const authorizationProvider = createAuthorizationProvider();
    const access = await authorizationProvider.checkAccess({
      idpAccessToken: claims.idpAccessToken,
      idpGroups: claims.idpGroups,
    });

    if (access === 'none') {
      return NextResponse.json(
        {
          error: 'access_denied',
          error_description: 'Your account does not have read or write access to this vault.',
        },
        { status: 403 },
      );
    }

    scope = access === 'write' ? 'mcp:read mcp:write' : 'mcp:read';
  } catch (err) {
    return NextResponse.json(
      { error: 'server_error', error_description: (err as Error).message },
      { status: 500 },
    );
  }

  const { baseUrl } = await resolveServerUrls();
  const audience = `${baseUrl.origin}/api/mcp`;

  const { token: accessToken } = await signAccessToken({
    userId: claims.sub,
    clientId: claims.clientId,
    scope,
    issuer: baseUrl.origin,
    audience,
    extra: {
      userToken: claims.idpAccessToken,
      userLogin: claims.idpLogin,
    },
  });

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/oauth/token/route.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/oauth/token/route.ts src/app/oauth/token/route.test.ts
git commit -m "feat: gate mcp:write scope on AuthorizationProvider.checkAccess"
```

---

### Task 7: Enforce `mcp:write` in the 7 write MCP tools

**Files:**
- Modify: `src/lib/mcp/tools.ts`
- Modify: `src/lib/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `ctx.authInfo.scopes: string[]` (already produced by `verifyMcpToken` in `src/lib/mcp/auth.ts`, which derives it by splitting the JWT's `scope` claim — that claim is now correctly gated per Task 6).
- Produces: `requireWriteScope(authInfo: unknown): { content: [{ type: 'text'; text: string }]; isError: true } | null`, called as the first line of `create_document`, `update_document`, `delete_document`, `publish_document`, `stage_drift_suggestion`, `approve_suggestion`, `reject_suggestion`.

- [ ] **Step 1: Update the test helper and add failing denial-path tests**

In `src/lib/mcp/tools.test.ts`, replace:

```ts
function makeCtx(userToken = 'ghp_test', userLogin = 'testuser') {
  return { authInfo: { extra: { userToken, userLogin } } };
}
```

with:

```ts
function makeCtx(userToken = 'ghp_test', userLogin = 'testuser', scopes = ['mcp:read', 'mcp:write']) {
  return { authInfo: { extra: { userToken, userLogin }, scopes } };
}
```

Then add a new describe block (place it right after the `describe('registerTools', ...)` opening, before `vault_info`, so it reads as a cross-cutting concern — or anywhere at the top level inside `describe('registerTools', ...)`; exact position doesn't matter to the test runner):

```ts
  describe('write-scope enforcement', () => {
    const WRITE_TOOLS = [
      { name: 'create_document', args: { path: 'nodes/new-doc', title: 'New Doc', type: 'document', body: 'Hello' } },
      { name: 'update_document', args: { path: 'nodes/existing' } },
      { name: 'delete_document', args: { path: 'nodes/existing' } },
      { name: 'publish_document', args: { path: 'nodes/existing' } },
      { name: 'stage_drift_suggestion', args: { path: 'nodes/existing' } },
      { name: 'approve_suggestion', args: { path: 'nodes/existing', suggestion_id: 'sugg-1' } },
      { name: 'reject_suggestion', args: { path: 'nodes/existing', suggestion_id: 'sugg-1', reason: 'no' } },
    ];

    it.each(WRITE_TOOLS)('$name rejects a read-only token before touching storage', async ({ name, args }) => {
      const { server, tools } = makeServerStub();
      const { registerTools } = await import('./tools.js');
      // @ts-expect-error — stub
      registerTools(server);

      const tool = tools.get(name);
      const result = (await tool!.handler(args, makeCtx('ghp_test', 'testuser', ['mcp:read']))) as {
        content: { text: string }[];
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/Insufficient permissions/);
      expect(mockStorage.readDocument).not.toHaveBeenCalled();
      expect(mockStorage.writeDocument).not.toHaveBeenCalled();
      expect(mockStorage.deleteDocument).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail (and existing ones still pass)**

Run: `pnpm vitest run src/lib/mcp/tools.test.ts`
Expected: the 7 new `it.each` cases FAIL (handlers currently proceed and hit storage regardless of scope — e.g. `create_document`/`update_document` will attempt `storage.readDocument` and the assertion `not.toHaveBeenCalled()` fails); all pre-existing tests still PASS (the `makeCtx` default now includes `scopes: ['mcp:read', 'mcp:write']`, so full-access behavior is unchanged)

- [ ] **Step 3: Add the `requireWriteScope` helper**

In `src/lib/mcp/tools.ts`, replace:

```ts
function getExtra(authInfo: unknown): McpExtra {
  return (authInfo as { extra: McpExtra }).extra;
}
```

with:

```ts
function getExtra(authInfo: unknown): McpExtra {
  return (authInfo as { extra: McpExtra }).extra;
}

function requireWriteScope(
  authInfo: unknown,
): { content: [{ type: 'text'; text: string }]; isError: true } | null {
  const scopes: string[] = (authInfo as { scopes?: string[] })?.scopes ?? [];
  if (!scopes.includes('mcp:write')) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error:
              'Insufficient permissions: this account has read-only access to this vault. Write access is required.',
          }),
        },
      ],
      isError: true,
    };
  }
  return null;
}
```

- [ ] **Step 4: Add the guard to the 7 write-tool handlers**

Each edit inserts the same two lines as the first statements of the handler body, before the existing `const extra = getExtra(ctx.authInfo);` line. Apply to all 7:

`create_document` — replace:
```ts
    async ({ path, title, type, tags, body, trigger, tools_required, output_format }, ctx) => {
      const extra = getExtra(ctx.authInfo);
```
with:
```ts
    async ({ path, title, type, tags, body, trigger, tools_required, output_format }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
```

`update_document` — replace:
```ts
    async ({ path, title, tags, status, body }, ctx) => {
      const extra = getExtra(ctx.authInfo);
```
with:
```ts
    async ({ path, title, tags, status, body }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
```

`delete_document` — replace:
```ts
    async ({ path }, ctx) => {
      const extra = getExtra(ctx.authInfo);
```
with:
```ts
    async ({ path }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
```

`publish_document` — replace:
```ts
    async ({ path, author, note }, ctx) => {
      const extra = getExtra(ctx.authInfo);
```
with:
```ts
    async ({ path, author, note }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
```

`stage_drift_suggestion` — replace:
```ts
    async ({ path, actor, note }, ctx) => {
      const extra = getExtra(ctx.authInfo);
```
with:
```ts
    async ({ path, actor, note }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
```

`approve_suggestion` — replace:
```ts
    async ({ path, suggestion_id, actor, comment }, ctx) => {
      const extra = getExtra(ctx.authInfo);
```
with:
```ts
    async ({ path, suggestion_id, actor, comment }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
```

`reject_suggestion` — replace:
```ts
    async ({ path, suggestion_id, reason, actor }, ctx) => {
      const extra = getExtra(ctx.authInfo);
```
with:
```ts
    async ({ path, suggestion_id, reason, actor }, ctx) => {
      const permErr = requireWriteScope(ctx.authInfo);
      if (permErr) return permErr;

      const extra = getExtra(ctx.authInfo);
```

Note: `create_document`, `update_document`, `delete_document`, `publish_document`, and `approve_suggestion` each destructure `const { storage, sync, userToken } = createEngine(...)` on the line after `getExtra`; `stage_drift_suggestion` and `reject_suggestion` destructure only `const { storage } = createEngine(...)`. Only the two-line guard shown above is inserted — the `createEngine` line and everything after it is unchanged in every case.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools.test.ts`
Expected: PASS (all tests, including the 7 new denial-path cases and every pre-existing write/read-tool test)

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/tools.ts src/lib/mcp/tools.test.ts
git commit -m "feat: enforce mcp:write scope on write MCP tools"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, including every file touched in Tasks 1–7

- [ ] **Step 2: Run the linter**

Run: `pnpm lint`
Expected: no errors or warnings. If new lint issues surface (e.g. unused imports), fix them and re-run.

- [ ] **Step 3: Run the production build**

Run: `pnpm build`
Expected: builds successfully with no TypeScript errors. If Next.js flags anything in the modified route handlers, fix and re-run.

- [ ] **Step 4: Manual acceptance check against the design spec**

Re-read `docs/superpowers/specs/2026-07-02-authorization-scope-gating-design.md`'s "Acceptance criteria" section and confirm each bullet is satisfied by the code as it now stands:
- No authenticated user automatically receives `mcp:write` (Task 6).
- `AUTH_PROVIDER=github` derives access from `AUTHZ_GITHUB_REPO` permissions (Tasks 1, 3, 6).
- `AUTH_PROVIDER=entra` derives access from `AUTHZ_ENTRA_WRITE_GROUP_ID`/`AUTHZ_ENTRA_READ_GROUP_ID`, claim-first with Graph fallback (Tasks 2, 3, 4, 5, 6).
- `'none'` access is denied a token (403), not issued a read-only token (Task 6).
- The 7 write MCP tools reject tokens lacking `mcp:write` (Task 7).
- All tests pass; build and lint are clean (Steps 1–3 above).

- [ ] **Step 5: Commit (only if Step 4 required fixes)**

```bash
git add -A
git commit -m "fix: address build/lint/acceptance gaps in authorization scope gating"
```

If Step 4 required no fixes, skip this commit — there's nothing new to record.
