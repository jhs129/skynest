import { jwtVerify } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getPublicKey } from '@/lib/oauth/keys';

export interface McpExtra {
  userToken: string; // IdP access token (repo-scoped, when the IdP is GitHub); empty under IdPs with no write-capable token
  userLogin: string; // IdP username/login used for attribution
  vaultId: string;   // selected vault, derived from MCP server URL path
}

export async function verifyMcpToken(
  token: string,
  resourceUrl: string,
): Promise<AuthInfo> {
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
