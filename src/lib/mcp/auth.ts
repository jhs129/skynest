import { timingSafeEqual } from 'crypto';
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

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Headless/service callers (deployed agents with no interactive login) present a
// pre-shared secret — MCP_BOT_TOKEN — as their bearer token instead of a JWT.
// Unset or non-matching tokens fall through to the JWT paths below, which will
// reject them, so this is purely additive and never weakens the existing checks.
function verifyBotToken(token: string): AuthInfo | undefined {
  const botToken = process.env.MCP_BOT_TOKEN;
  if (!botToken || !timingSafeCompare(token, botToken)) return undefined;

  const botLogin = process.env.MCP_BOT_LOGIN ?? 'skynest-bot';
  const extra: Record<string, unknown> = {
    userToken: process.env.BOT_GITHUB_TOKEN ?? '',
    userLogin: botLogin,
  };
  return {
    token,
    clientId: botLogin,
    scopes: ['mcp:read', 'mcp:write'],
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

  const botAuthInfo = verifyBotToken(token);
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
