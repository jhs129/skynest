import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth/providers/github', () => ({
  default: vi.fn((config) => ({ id: 'github', type: 'oauth', ...config })),
}));

vi.mock('next-auth/providers/microsoft-entra-id', () => ({
  default: vi.fn((config) => ({ id: 'microsoft-entra-id', type: 'oidc', ...config })),
}));

async function loadAuthConfig() {
  const { authConfig } = await import('./auth.config.js');
  return authConfig;
}

describe('authConfig provider selection', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AUTH_PROVIDER;
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_CLIENT_ID;
    delete process.env.ENTRA_CLIENT_SECRET;
    process.env.GITHUB_CLIENT_ID = 'gh-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-client-secret';
  });

  it('defaults to a single GitHub provider when AUTH_PROVIDER is unset', async () => {
    const authConfig = await loadAuthConfig();
    expect(authConfig.providers).toHaveLength(1);
    expect(authConfig.providers[0].id).toBe('github');
  });

  it('uses a single Microsoft Entra ID provider when AUTH_PROVIDER=entra', async () => {
    process.env.AUTH_PROVIDER = 'entra';
    process.env.ENTRA_TENANT_ID = 'test-tenant';
    process.env.ENTRA_CLIENT_ID = 'entra-client-id';
    process.env.ENTRA_CLIENT_SECRET = 'entra-client-secret';

    const authConfig = await loadAuthConfig();
    expect(authConfig.providers).toHaveLength(1);
    expect(authConfig.providers[0].id).toBe('microsoft-entra-id');
    expect(authConfig.providers[0].issuer).toBe(
      'https://login.microsoftonline.com/test-tenant/v2.0'
    );
  });

  it('throws when AUTH_PROVIDER=entra is missing ENTRA_TENANT_ID', async () => {
    process.env.AUTH_PROVIDER = 'entra';
    await expect(loadAuthConfig()).rejects.toThrow(
      /ENTRA_TENANT_ID is required when AUTH_PROVIDER=entra/
    );
  });
});

describe('authConfig callbacks', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AUTH_PROVIDER;
    process.env.GITHUB_CLIENT_ID = 'gh-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-client-secret';
  });

  it('jwt callback carries a GitHub access token and login into idpAccessToken/idpLogin', async () => {
    const authConfig = await loadAuthConfig();
    const token = await authConfig.callbacks!.jwt!({
      token: { name: 'Fallback Name' },
      account: { provider: 'github', access_token: 'ghp_abc', login: 'octocat' } as never,
    } as never);
    expect(token.idpAccessToken).toBe('ghp_abc');
    expect(token.idpLogin).toBe('octocat');
  });

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

  it('jwt callback falls back to email when Entra ID profile has no preferred_username', async () => {
    const authConfig = await loadAuthConfig();
    const token = await authConfig.callbacks!.jwt!({
      token: { name: 'Fallback Name' },
      account: { provider: 'microsoft-entra-id' } as never,
      profile: { email: 'jane@other.com' } as never,
    } as never);
    expect(token.idpLogin).toBe('jane@other.com');
  });

  it('session callback copies idpAccessToken/idpLogin from the token onto the session', async () => {
    const authConfig = await loadAuthConfig();
    const session = await authConfig.callbacks!.session!({
      session: { user: {}, expires: '' } as never,
      token: { idpAccessToken: 'ghp_abc', idpLogin: 'octocat' } as never,
    } as never);
    expect((session as { idpAccessToken?: string }).idpAccessToken).toBe('ghp_abc');
    expect((session as { idpLogin?: string }).idpLogin).toBe('octocat');
  });
});
