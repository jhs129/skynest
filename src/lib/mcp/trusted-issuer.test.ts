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
