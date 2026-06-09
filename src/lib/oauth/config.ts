// Static configuration for the OAuth 2.1 authorization server.
// Issuer/base URL is derived per-request from the incoming Host header (see
// resolveServerUrls in ./urls.ts) so the same code serves production and preview
// deployments correctly.

export const OAUTH_SCOPES = ['mcp:read', 'mcp:write'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const ACCESS_TOKEN_TTL_SECONDS = process.env.ACCESS_TOKEN_TTL_SECONDS
  ? parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 10)
  : 7 * 24 * 60 * 60; // default: 7 days
export const AUTH_CODE_TTL_SECONDS = 60; // 1 minute

export const OAUTH_ALGORITHM = 'RS256' as const;

/** Resource identifier — audience claim in access tokens. */
export function getResourceUrl(host: string): string {
  return `https://${host}`;
}
