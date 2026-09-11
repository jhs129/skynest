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

// Headless/service callers (deployed agents with no interactive login, so no
// GitHub OAuth dance) present their own real GitHub PAT as the bearer token —
// the same kind of repo-scoped token an interactive user's session carries
// after signing in. This mirrors exactly what src/app/oauth/token/route.ts
// does at token-exchange time for interactive users: check real GitHub access
// with the caller's own token, then pass that same token through as
// extra.userToken so commits are attributed to the real identity behind it.
//
// Only applies when this instance's authorization model understands GitHub
// tokens at all (AUTH_PROVIDER=github, the default). A raw PAT is never a
// valid JWT, so decodeJwt failing is what identifies "this might be a PAT" —
// anything JWT-shaped is left untouched for the paths below. Any failure here
// (no access, GitHub API rejects it, wrong AUTH_PROVIDER) simply falls through
// to verifySelfIssuedToken, which will reject a non-JWT string — so this can
// only grant access, never silently bypass the existing checks.
async function verifyGitHubPatToken(token: string): Promise<AuthInfo | undefined> {
  if ((process.env.AUTH_PROVIDER ?? 'github') !== 'github') return undefined;

  try {
    decodeJwt(token);
    return undefined; // JWT-shaped — not a PAT candidate, let the JWT paths handle it
  } catch {
    // not a JWT — proceed to validate it as a real GitHub token
  }

  let access;
  try {
    access = await createAuthorizationProvider().checkAccess({ idpAccessToken: token });
  } catch {
    return undefined;
  }
  if (access === 'none') return undefined;

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!userRes.ok) return undefined;
  const { login } = (await userRes.json()) as { login?: string };
  if (!login) return undefined;

  const extra: Record<string, unknown> = {
    userToken: token,
    userLogin: login,
  };
  return {
    token,
    clientId: login,
    scopes: access === 'write' ? ['mcp:read', 'mcp:write'] : ['mcp:read'],
    extra,
  };
}

async function verifyExternalToken(token: string): Promise<AuthInfo> {
  const issuer = process.env.MCP_TRUSTED_ISSUER as string;
  const audience = process.env.MCP_TRUSTED_AUDIENCE;

  if (!audience) {
    throw new Error('MCP_TRUSTED_AUDIENCE must be set when MCP_TRUSTED_ISSUER is set');
  }

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

  const botAuthInfo = await verifyGitHubPatToken(token);
  if (botAuthInfo) return botAuthInfo;

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
