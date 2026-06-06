import { jwtVerify } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getPublicKey } from '@/lib/oauth/keys';

export interface McpExtra {
  userToken: string; // GitHub OAuth access token
  userLogin: string; // GitHub username
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

  const extra = (payload['extra'] ?? {}) as Record<string, unknown>;
  return {
    token,
    clientId: payload['client_id'] as string,
    scopes: ((payload['scope'] as string) ?? '').split(' ').filter(Boolean),
    extra,
  };
}
