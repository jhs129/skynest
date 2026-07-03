import { jwtVerify } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getPublicKey } from '@/lib/oauth/keys';

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

export async function verifyMcpToken(
  token: string | undefined,
  resourceUrl: string,
): Promise<AuthInfo | undefined> {
  if (AUTH_DISABLED) return devBypassAuthInfo();
  if (!token) return undefined;

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
