import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAuthorizationProvider } from './github-authorization-provider.js';

const fetchMock = vi.fn();
global.fetch = fetchMock;

const provider = new GitHubAuthorizationProvider({ repo: 'owner/testrepo' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubAuthorizationProvider.checkAccess', () => {
  it('returns write when the user has admin permission', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: true, push: false, pull: true } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('write');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/testrepo',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_test' }),
      }),
    );
  });

  it('returns write when the user has push permission', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: false, push: true, pull: true } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('write');
  });

  it('returns read when the user only has pull permission', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: false, push: false, pull: true } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('read');
  });

  it('returns none when permissions are all false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permissions: { admin: false, push: false, pull: false } }),
    });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });

  it('returns none when the response has no permissions field', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });

  it('returns none on a 404 (no repo access)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });

  it('returns none on a 403 (rate-limited or blocked)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'ghp_test' });
    expect(access).toBe('none');
  });
});
