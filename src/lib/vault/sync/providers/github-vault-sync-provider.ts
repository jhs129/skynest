import type { GitVaultSyncProvider } from '../git-vault-sync-provider.js';

interface Config {
  repo: string;   // "owner/repo"
  branch: string; // e.g. "main"
  maxRetries?: number;  // PUT attempts after the first, on retryable statuses (default 4)
  retryBaseMs?: number; // exponential backoff base in ms (default 500)
}

// GitHub Contents API responses that are worth retrying. 403/429 are secondary
// (abuse) rate limits that a backfill of dozens of files trips; 409/422 mean the
// SHA we sent was stale or missing — usually because a prior throttled GET left
// the SHA cache empty, so the PUT went out without one and GitHub rejected an
// update to an existing file ("\"sha\" wasn't supplied."). Re-fetching the SHA
// fresh and retrying clears all of these.
const RETRYABLE_STATUSES = new Set([403, 409, 422, 429, 500, 502, 503, 504]);

export class GitHubVaultSyncProvider implements GitVaultSyncProvider {
  private shaCache = new Map<string, string>();

  constructor(private readonly config: Config) {}

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private apiUrl(path: string): string {
    return `https://api.github.com/repos/${this.config.repo}/contents/${path}`;
  }

  private headers(userToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  private async fetchSha(path: string, userToken: string, forceRefresh = false): Promise<string | undefined> {
    if (!forceRefresh && this.shaCache.has(path)) return this.shaCache.get(path);
    try {
      const res = await fetch(
        `${this.apiUrl(path)}?ref=${this.config.branch}`,
        { headers: this.headers(userToken) }
      );
      if (!res.ok) return undefined;
      const data = await res.json() as { sha?: string };
      if (data.sha) this.shaCache.set(path, data.sha);
      return data.sha;
    } catch {
      return undefined;
    }
  }

  async commitFile(params: { path: string; content: Buffer; message: string; userToken: string }): Promise<void> {
    const maxRetries = this.config.maxRetries ?? 4;
    const baseMs = this.config.retryBaseMs ?? 500;
    let lastStatus = 0;
    let lastDetail = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // After a failed attempt, bypass the SHA cache: a stale or missing SHA is
      // the usual cause of 409/422, and a throttled first GET can leave the cache
      // empty. Re-fetching gets the file's current SHA before we retry the PUT.
      const sha = await this.fetchSha(params.path, params.userToken, attempt > 0);
      const body: Record<string, unknown> = {
        message: params.message,
        content: params.content.toString('base64'),
        branch: this.config.branch,
      };
      if (sha) body.sha = sha;

      const res = await fetch(this.apiUrl(params.path), {
        method: 'PUT',
        headers: this.headers(params.userToken),
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json() as { content?: { sha?: string } };
        if (data.content?.sha) this.shaCache.set(params.path, data.content.sha);
        return;
      }

      // Drop any cached SHA so the next attempt re-fetches a fresh one.
      this.shaCache.delete(params.path);
      lastStatus = res.status;
      lastDetail = await res.text().catch(() => '');

      if (attempt < maxRetries && RETRYABLE_STATUSES.has(res.status)) {
        await this.sleep(baseMs * 2 ** attempt);
        continue;
      }
      break;
    }

    throw new Error(`GitHub sync failed: PUT ${params.path} → HTTP ${lastStatus}: ${lastDetail.slice(0, 300)}`);
  }

  async deleteFile(params: { path: string; message: string; userToken: string }): Promise<void> {
    const sha = await this.fetchSha(params.path, params.userToken);
    if (!sha) return; // file doesn't exist in git — nothing to delete

    const res = await fetch(this.apiUrl(params.path), {
      method: 'DELETE',
      headers: this.headers(params.userToken),
      body: JSON.stringify({
        message: params.message,
        sha,
        branch: this.config.branch,
      }),
    });

    this.shaCache.delete(params.path);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`GitHub sync failed: DELETE ${params.path} → HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}
