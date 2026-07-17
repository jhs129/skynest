import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/oauth/jwt', () => ({
  verifyAuthCode: vi.fn(),
  signAccessToken: vi.fn(),
}));

vi.mock('@/lib/oauth/pkce', () => ({
  verifyPkce: vi.fn(),
}));

vi.mock('@/lib/oauth/urls', () => ({
  resolveServerUrls: vi.fn(),
}));

vi.mock('@/lib/authorization/authorization-factory', () => ({
  createAuthorizationProvider: vi.fn(),
}));

import { verifyAuthCode, signAccessToken } from '@/lib/oauth/jwt';
import { verifyPkce } from '@/lib/oauth/pkce';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { createAuthorizationProvider } from '@/lib/authorization/authorization-factory';
import { POST } from './route';

const VALID_CLAIMS = {
  sub: 'user@example.com',
  clientId: 'mcpc_abc',
  redirectUri: 'http://localhost:8765/callback',
  codeChallenge: 'challenge-value',
  idpAccessToken: 'idp-token',
  idpLogin: 'octocat',
};

const VALID_FIELDS = {
  grant_type: 'authorization_code',
  code: 'auth-code-value',
  code_verifier: 'a'.repeat(43),
  redirect_uri: 'http://localhost:8765/callback',
};

function makeRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest('http://localhost/oauth/token', { method: 'POST', body: formData });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyAuthCode).mockResolvedValue(VALID_CLAIMS);
  vi.mocked(verifyPkce).mockReturnValue(true);
  vi.mocked(resolveServerUrls).mockResolvedValue({
    baseUrl: new URL('http://localhost'),
    issuer: new URL('http://localhost'),
    resourceUrl: new URL('http://localhost'),
  });
  vi.mocked(signAccessToken).mockResolvedValue({ token: 'signed-jwt', expiresIn: 604800 });
});

describe('POST /oauth/token', () => {
  it('returns invalid_request when required fields are missing', async () => {
    const res = await POST(makeRequest({ grant_type: 'authorization_code' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns invalid_grant when PKCE verification fails, without checking authorization', async () => {
    vi.mocked(verifyPkce).mockReturnValue(false);
    const res = await POST(makeRequest(VALID_FIELDS));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
    expect(createAuthorizationProvider).not.toHaveBeenCalled();
  });

  it('issues both scopes when the authorization provider grants write access', async () => {
    vi.mocked(createAuthorizationProvider).mockReturnValue({
      checkAccess: vi.fn().mockResolvedValue('write'),
    } as never);

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope).toBe('mcp:read mcp:write');
    expect(signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mcp:read mcp:write' }),
    );
  });

  it('issues read-only scope when the authorization provider grants read access', async () => {
    vi.mocked(createAuthorizationProvider).mockReturnValue({
      checkAccess: vi.fn().mockResolvedValue('read'),
    } as never);

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope).toBe('mcp:read');
    expect(signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mcp:read' }),
    );
  });

  it('returns 403 access_denied when the authorization provider grants no access', async () => {
    vi.mocked(createAuthorizationProvider).mockReturnValue({
      checkAccess: vi.fn().mockResolvedValue('none'),
    } as never);

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('access_denied');
    expect(signAccessToken).not.toHaveBeenCalled();
  });

  it('returns 500 server_error when the authorization provider is misconfigured', async () => {
    vi.mocked(createAuthorizationProvider).mockImplementation(() => {
      throw new Error('AUTHZ_GITHUB_REPO env var is required when AUTH_PROVIDER=github');
    });

    const res = await POST(makeRequest(VALID_FIELDS));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('server_error');
    expect(body.error_description).toMatch(/AUTHZ_GITHUB_REPO/);
  });

  it('passes idpAccessToken and idpGroups from the auth code claims to checkAccess', async () => {
    vi.mocked(verifyAuthCode).mockResolvedValue({ ...VALID_CLAIMS, idpGroups: ['group-a'] });
    const checkAccess = vi.fn().mockResolvedValue('write');
    vi.mocked(createAuthorizationProvider).mockReturnValue({ checkAccess } as never);

    await POST(makeRequest(VALID_FIELDS));

    expect(checkAccess).toHaveBeenCalledWith({ idpAccessToken: 'idp-token', idpGroups: ['group-a'] });
  });
});
