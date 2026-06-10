import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubVaultSyncProvider } from './github-vault-sync-provider.js';

const fetchMock = vi.fn();
global.fetch = fetchMock;

const provider = new GitHubVaultSyncProvider({ repo: 'owner/testrepo', branch: 'main' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubVaultSyncProvider.commitFile', () => {
  it('creates a new file when no SHA exists', async () => {
    // HEAD returns 404 (file does not exist)
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) }) // GET sha
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'abc123' } }) }); // PUT

    await provider.commitFile({
      path: 'nodes/new-doc.md',
      content: Buffer.from('# New Doc'),
      message: 'create new-doc',
      userToken: 'ghp_testtoken',
    });

    const putCall = fetchMock.mock.calls[1];
    const body = JSON.parse(putCall[1].body);
    expect(putCall[0]).toContain('/repos/owner/testrepo/contents/nodes/new-doc.md');
    expect(body.message).toBe('create new-doc');
    expect(body.sha).toBeUndefined(); // no sha for new file
    expect(body.branch).toBe('main');
    expect(putCall[1].headers.Authorization).toBe('Bearer ghp_testtoken');
  });

  it('includes SHA when updating an existing file', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'existing-sha' }) }) // GET sha
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'new-sha' } }) }); // PUT

    await provider.commitFile({
      path: 'nodes/existing.md',
      content: Buffer.from('updated'),
      message: 'update existing',
      userToken: 'ghp_testtoken',
    });

    const putCall = fetchMock.mock.calls[1];
    const body = JSON.parse(putCall[1].body);
    expect(body.sha).toBe('existing-sha');
  });

  it('throws on a non-ok GitHub PUT response (surfaces failure to caller)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) }) // GET sha
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'forbidden' }); // PUT
    await expect(provider.commitFile({
      path: 'nodes/doc.md',
      content: Buffer.from('x'),
      message: 'test',
      userToken: 'ghp_testtoken',
    })).rejects.toThrow(/GitHub sync failed.*403/);
  });
});

describe('GitHubVaultSyncProvider.deleteFile', () => {
  it('fetches SHA then sends DELETE commit', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'del-sha' }) }) // GET sha
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // DELETE

    await provider.deleteFile({
      path: 'nodes/old.md',
      message: 'delete old',
      userToken: 'ghp_testtoken',
    });

    const deleteCall = fetchMock.mock.calls[1];
    const body = JSON.parse(deleteCall[1].body);
    expect(deleteCall[1].method).toBe('DELETE');
    expect(body.sha).toBe('del-sha');
  });
});
