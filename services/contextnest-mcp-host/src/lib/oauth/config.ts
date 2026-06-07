// Static configuration for the OAuth 2.1 authorization server.
// Issuer/base URL is derived per-request from the incoming Host header (see
// resolveServerUrls in ./urls.ts) so the same code serves production and preview
// deployments correctly.

export const OAUTH_SCOPES = ['mcp:read', 'mcp:write'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8 hours (no refresh tokens in MVP)
export const AUTH_CODE_TTL_SECONDS = 60; // 1 minute

export const OAUTH_ALGORITHM = 'RS256' as const;

/** Resource identifier — audience claim in access tokens. */
export function getResourceUrl(host: string): string {
  return `https://${host}/api/mcp`;
}
