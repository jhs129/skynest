import { describe, it, expect, vi } from 'vitest';

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
    expect(result.extra).toMatchObject({ userToken: 'ghp_abc', userLogin: 'testuser' });
    expect(result.clientId).toBe('mcpc_abc');
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
});
