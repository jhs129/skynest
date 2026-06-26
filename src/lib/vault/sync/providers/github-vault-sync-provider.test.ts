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

  it('throws immediately on a non-retryable PUT response (surfaces failure to caller)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) }) // GET sha
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad credentials' }); // PUT
    await expect(provider.commitFile({
      path: 'nodes/doc.md',
      content: Buffer.from('x'),
      message: 'test',
      userToken: 'ghp_testtoken',
    })).rejects.toThrow(/GitHub sync failed.*401/);
    // 401 is not retryable: one GET + one PUT, then it gives up.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a throttled 422 after re-fetching the SHA, then succeeds', async () => {
    const retryProvider = new GitHubVaultSyncProvider({
      repo: 'owner/testrepo', branch: 'main', retryBaseMs: 0,
    });
    fetchMock
      // attempt 0: throttled GET yields no sha, so the PUT omits it → GitHub 422
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) }) // GET sha (throttled)
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => '"sha" wasn\'t supplied.' }) // PUT
      // attempt 1: fresh GET returns the real sha → PUT succeeds
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'real-sha' }) }) // GET sha (forced)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'committed-sha' } }) }); // PUT

    await retryProvider.commitFile({
      path: 'nodes/flaky.md',
      content: Buffer.from('y'),
      message: 'retry me',
      userToken: 'ghp_testtoken',
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const retriedPut = fetchMock.mock.calls[3];
    expect(retriedPut[1].method).toBe('PUT');
    expect(JSON.parse(retriedPut[1].body).sha).toBe('real-sha');
  });

  it('gives up after maxRetries on a persistent retryable status', async () => {
    const retryProvider = new GitHubVaultSyncProvider({
      repo: 'owner/testrepo', branch: 'main', retryBaseMs: 0, maxRetries: 2,
    });
    // Every GET 404 (no sha) and every PUT 403 (persistent throttle).
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? { ok: false, status: 403, text: async () => 'rate limited' }
        : { ok: false, status: 404, json: async () => ({}) }
    );

    await expect(retryProvider.commitFile({
      path: 'nodes/doc.md',
      content: Buffer.from('x'),
      message: 'test',
      userToken: 'ghp_testtoken',
    })).rejects.toThrow(/GitHub sync failed.*403/);

    // 3 PUT attempts (initial + 2 retries), each preceded by a GET → 6 calls.
    const putCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT');
    expect(putCalls).toHaveLength(3);
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
