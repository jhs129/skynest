import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntraAuthorizationProvider } from './entra-authorization-provider.js';

const fetchMock = vi.fn();
global.fetch = fetchMock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EntraAuthorizationProvider.checkAccess — claim-based (idpGroups present)', () => {
  const provider = new EntraAuthorizationProvider({
    writeGroupIds: ['write-group-id'],
    readGroupIds: ['read-group-id'],
  });

  it('returns write when idpGroups contains the write group', async () => {
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['write-group-id'] });
    expect(access).toBe('write');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns read when idpGroups contains only the read group', async () => {
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['read-group-id'] });
    expect(access).toBe('read');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns none when idpGroups contains neither group', async () => {
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['other-group'] });
    expect(access).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('EntraAuthorizationProvider.checkAccess — multiple groups per level', () => {
  const provider = new EntraAuthorizationProvider({
    writeGroupIds: ['careteam-group-id', 'led-group-id'],
    readGroupIds: ['readers-group-id'],
  });

  it('returns write on membership in any configured write group', async () => {
    for (const group of ['careteam-group-id', 'led-group-id']) {
      const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: [group] });
      expect(access).toBe('write');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers write when the user is in both a write and a read group', async () => {
    const access = await provider.checkAccess({
      idpAccessToken: 'tok',
      idpGroups: ['readers-group-id', 'led-group-id'],
    });
    expect(access).toBe('write');
  });

  it('sends every configured group ID to the Graph fallback', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: ['led-group-id'] }) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('write');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/checkMemberGroups',
      expect.objectContaining({
        body: JSON.stringify({
          groupIds: ['careteam-group-id', 'led-group-id', 'readers-group-id'],
        }),
      }),
    );
  });
});

describe('EntraAuthorizationProvider.checkAccess — Graph fallback (idpGroups undefined)', () => {
  const provider = new EntraAuthorizationProvider({
    writeGroupIds: ['write-group-id'],
    readGroupIds: ['read-group-id'],
  });

  it('calls checkMemberGroups and returns write when it lists the write group', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: ['write-group-id'] }) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('write');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/checkMemberGroups',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ groupIds: ['write-group-id', 'read-group-id'] }),
      }),
    );
  });

  it('returns read when checkMemberGroups lists only the read group', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: ['read-group-id'] }) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('read');
  });

  it('returns none when checkMemberGroups lists neither group', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('none');
  });

  it('returns none when the Graph call fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    const access = await provider.checkAccess({ idpAccessToken: 'tok' });
    expect(access).toBe('none');
  });
});

describe('EntraAuthorizationProvider.checkAccess — no groups configured', () => {
  it('fails closed to none without calling fetch', async () => {
    const provider = new EntraAuthorizationProvider({});
    const access = await provider.checkAccess({ idpAccessToken: 'tok', idpGroups: ['anything'] });
    expect(access).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
