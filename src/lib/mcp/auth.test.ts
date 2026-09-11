import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/oauth/keys', () => ({
  getPublicKey: vi.fn(),
}));

describe('verifyMcpToken', () => {
  it('returns AuthInfo with userToken and userLogin from valid JWT claims', async () => {
    const { SignJWT, generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');

    const { getPublicKey } = await import('@/lib/oauth/keys');
    vi.mocked(getPublicKey).mockResolvedValue(publicKey);

    const token = await new SignJWT({
      sub: 'user-123',
      client_id: 'mcpc_abc',
      scope: 'mcp:read mcp:write',
      userToken: 'ghp_abc',
      userLogin: 'testuser',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setAudience('https://example.com/api/mcp')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(privateKey);

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');
    expect(result?.extra).toMatchObject({ userToken: 'ghp_abc', userLogin: 'testuser' });
    expect(result?.clientId).toBe('mcpc_abc');
  });

  it('throws on expired token', async () => {
    const { generateKeyPair, SignJWT } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const { getPublicKey } = await import('@/lib/oauth/keys');
    vi.mocked(getPublicKey).mockResolvedValue(publicKey);

    const token = await new SignJWT({ sub: 'u', client_id: 'c', scope: 's', extra: {} })
      .setProtectedHeader({ alg: 'RS256' })
      .setAudience('https://example.com/api/mcp')
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(privateKey);

    const { verifyMcpToken } = await import('./auth.js');
    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
  });

  it('returns undefined when no token is provided and auth is not disabled', async () => {
    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(undefined, 'https://example.com/api/mcp');
    expect(result).toBeUndefined();
  });

  describe('with MCP_AUTH_DISABLED=true', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.MCP_AUTH_DISABLED = 'true';
    });

    afterEach(() => {
      delete process.env.MCP_AUTH_DISABLED;
    });

    it('returns a synthetic AuthInfo with full scopes even without a token', async () => {
      const { verifyMcpToken } = await import('./auth.js');
      const result = await verifyMcpToken(undefined, 'https://example.com/api/mcp');
      expect(result?.scopes).toEqual(expect.arrayContaining(['mcp:read', 'mcp:write']));
      expect(result?.extra).toMatchObject({ userLogin: expect.any(String) });
    });

    it('ignores a real token entirely and never calls getPublicKey', async () => {
      const { getPublicKey } = await import('@/lib/oauth/keys');
      vi.mocked(getPublicKey).mockClear();
      const { verifyMcpToken } = await import('./auth.js');
      const result = await verifyMcpToken('some-token', 'https://example.com/api/mcp');
      expect(result).toBeDefined();
      expect(getPublicKey).not.toHaveBeenCalled();
    });
  });
});

describe('verifyMcpToken with a trusted external issuer', () => {
  const ISSUER = 'https://login.microsoftonline.com/test-tenant/v2.0';
  const AUDIENCE = 'api://skynest-app-id';

  beforeEach(() => {
    vi.resetModules();
    process.env.MCP_TRUSTED_ISSUER = ISSUER;
    process.env.MCP_TRUSTED_AUDIENCE = AUDIENCE;
  });

  afterEach(() => {
    delete process.env.MCP_TRUSTED_ISSUER;
    delete process.env.MCP_TRUSTED_AUDIENCE;
    vi.clearAllMocks();
  });

  async function signExternalToken(
    privateKey: CryptoKey,
    claims: Record<string, unknown>,
    opts: { expiresIn?: string; audience?: string; issuer?: string } = {},
  ) {
    const { SignJWT } = await import('jose');
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(privateKey);
  }

  async function mockResolveJwks(publicKey: CryptoKey) {
    const { generateKeyPair: _unused } = await import('jose');
    void _unused;
    vi.doMock('./trusted-issuer.js', () => ({
      resolveJwks: vi.fn(async () => publicKey),
    }));
  }

  it('accepts a valid external token, calls checkAccess with the groups claim, and returns write scopes', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async (identity: { idpGroups?: string[] }) => {
          expect(identity.idpGroups).toEqual(['grp-write']);
          return 'write';
        }),
      }),
    }));

    const token = await signExternalToken(privateKey, {
      groups: ['grp-write'],
      preferred_username: 'staff@example.com',
      azp: 'connector-client-id',
    });

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');

    expect(result?.scopes).toEqual(['mcp:read', 'mcp:write']);
    expect(result?.clientId).toBe('connector-client-id');
    expect(result?.extra).toMatchObject({ userLogin: 'staff@example.com', userToken: token });
  });

  it('grants read-only scopes when checkAccess resolves "read"', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async () => 'read'),
      }),
    }));

    const token = await signExternalToken(privateKey, { groups: ['grp-read'] });
    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');

    expect(result?.scopes).toEqual(['mcp:read']);
  });

  it('rejects when checkAccess resolves "none"', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async () => 'none'),
      }),
    }));

    const token = await signExternalToken(privateKey, { groups: [] });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
  });

  it('calls checkAccess with idpGroups undefined when the groups claim is absent (overage case), and propagates a thrown provider error', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);

    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({
        checkAccess: vi.fn(async (identity: { idpGroups?: string[] }) => {
          expect(identity.idpGroups).toBeUndefined();
          throw new Error('Graph call failed: wrong audience');
        }),
      }),
    }));

    const token = await signExternalToken(privateKey, {});
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow(
      /Graph call failed/,
    );
  });

  it('rejects a token whose aud does not match MCP_TRUSTED_AUDIENCE, before checkAccess is called', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    const token = await signExternalToken(privateKey, { groups: [] }, { audience: 'api://wrong' });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it('rejects when MCP_TRUSTED_ISSUER is set but MCP_TRUSTED_AUDIENCE is unset (fails closed)', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    delete process.env.MCP_TRUSTED_AUDIENCE;

    const token = await signExternalToken(privateKey, { groups: [] });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it('rejects an expired external token, before checkAccess is called', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(publicKey);
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    const token = await signExternalToken(privateKey, { groups: [] }, { expiresIn: '-1s' });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it('rejects a token signed by an untrusted key', async () => {
    const { generateKeyPair } = await import('jose');
    const { privateKey: untrustedKey } = await generateKeyPair('RS256');
    const { publicKey: trustedPublicKey } = await generateKeyPair('RS256');
    await mockResolveJwks(trustedPublicKey);
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    const token = await signExternalToken(untrustedKey, { groups: [] });
    const { verifyMcpToken } = await import('./auth.js');

    await expect(verifyMcpToken(token, 'https://example.com/api/mcp')).rejects.toThrow();
    expect(checkAccess).not.toHaveBeenCalled();
  });
});

describe('verifyMcpToken with a raw GitHub PAT (headless-agent passthrough)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.AUTH_PROVIDER; // defaults to 'github'
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('accepts a real GitHub PAT with push access, and passes the same token through for attribution', async () => {
    const checkAccess = vi.fn(async () => 'write');
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'skynest-agent' }),
    });

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken('ghp_realtoken123', 'https://example.com/api/mcp');

    expect(checkAccess).toHaveBeenCalledWith({ idpAccessToken: 'ghp_realtoken123' });
    expect(result?.clientId).toBe('skynest-agent');
    expect(result?.scopes).toEqual(['mcp:read', 'mcp:write']);
    expect(result?.extra).toMatchObject({
      userToken: 'ghp_realtoken123',
      userLogin: 'skynest-agent',
    });
  });

  it('grants read-only scopes for a PAT with only pull access', async () => {
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess: vi.fn(async () => 'read') }),
    }));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ login: 'read-only-bot' }) });

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken('ghp_readonly', 'https://example.com/api/mcp');

    expect(result?.scopes).toEqual(['mcp:read']);
  });

  it('falls through to existing JWT verification (and rejects) when GitHub reports no access', async () => {
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess: vi.fn(async () => 'none') }),
    }));

    const { verifyMcpToken } = await import('./auth.js');
    await expect(verifyMcpToken('ghp_no_access', 'https://example.com/api/mcp')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls through to existing JWT verification (and rejects) when GET /user fails', async () => {
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess: vi.fn(async () => 'write') }),
    }));
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    const { verifyMcpToken } = await import('./auth.js');
    await expect(verifyMcpToken('ghp_bad_lookup', 'https://example.com/api/mcp')).rejects.toThrow();
  });

  it('never attempts PAT passthrough for a JWT-shaped token, and does not call GitHub', async () => {
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));
    const { getPublicKey } = await import('@/lib/oauth/keys');
    vi.mocked(getPublicKey).mockClear();

    const { SignJWT, generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    vi.mocked(getPublicKey).mockResolvedValue(publicKey);
    const token = await new SignJWT({ sub: 'u', client_id: 'c', scope: 'mcp:read' })
      .setProtectedHeader({ alg: 'RS256' })
      .setAudience('https://example.com/api/mcp')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(privateKey);

    const { verifyMcpToken } = await import('./auth.js');
    await verifyMcpToken(token, 'https://example.com/api/mcp');

    expect(checkAccess).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not attempt PAT passthrough when AUTH_PROVIDER=entra', async () => {
    process.env.AUTH_PROVIDER = 'entra';
    const checkAccess = vi.fn();
    vi.doMock('@/lib/authorization/authorization-factory', () => ({
      createAuthorizationProvider: () => ({ checkAccess }),
    }));

    const { verifyMcpToken } = await import('./auth.js');
    await expect(verifyMcpToken('ghp_realtoken123', 'https://example.com/api/mcp')).rejects.toThrow();

    expect(checkAccess).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.AUTH_PROVIDER;
  });
});

describe('verifyMcpToken routing when MCP_TRUSTED_ISSUER is unset', () => {
  it('still verifies self-issued tokens exactly as before (regression guard)', async () => {
    vi.resetModules();
    delete process.env.MCP_TRUSTED_ISSUER;
    delete process.env.MCP_TRUSTED_AUDIENCE;

    const { SignJWT, generateKeyPair } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const { getPublicKey } = await import('@/lib/oauth/keys');
    vi.mocked(getPublicKey).mockResolvedValue(publicKey);

    const token = await new SignJWT({
      sub: 'user-123',
      client_id: 'mcpc_abc',
      scope: 'mcp:read',
      userToken: 'ghp_abc',
      userLogin: 'testuser',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/some-other-tenant/v2.0')
      .setAudience('https://example.com/api/mcp')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(privateKey);

    const { verifyMcpToken } = await import('./auth.js');
    const result = await verifyMcpToken(token, 'https://example.com/api/mcp');
    expect(result?.extra).toMatchObject({ userToken: 'ghp_abc', userLogin: 'testuser' });
  });
});
