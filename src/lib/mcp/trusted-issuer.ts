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
