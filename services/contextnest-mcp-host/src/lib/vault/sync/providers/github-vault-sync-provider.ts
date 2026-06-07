import type { GitVaultSyncProvider } from '../git-vault-sync-provider.js';

interface Config {
  repo: string;   // "owner/repo"
  branch: string; // e.g. "main"
}

export class GitHubVaultSyncProvider implements GitVaultSyncProvider {
  private shaCache = new Map<string, string>();

  constructor(private readonly config: Config) {}

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

  private async fetchSha(path: string, userToken: string): Promise<string | undefined> {
    if (this.shaCache.has(path)) return this.shaCache.get(path);
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
    try {
      const sha = await this.fetchSha(params.path, params.userToken);
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
      } else {
        this.shaCache.delete(params.path);
        console.error(`[GitHubVaultSync] PUT failed: ${res.status} ${params.path}`);
      }
    } catch (err) {
      this.shaCache.delete(params.path);
      console.error(`[GitHubVaultSync] commitFile error:`, err);
    }
  }

  async deleteFile(params: { path: string; message: string; userToken: string }): Promise<void> {
    try {
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
        console.error(`[GitHubVaultSync] DELETE failed: ${res.status} ${params.path}`);
      }
    } catch (err) {
      this.shaCache.delete(params.path);
      console.error(`[GitHubVaultSync] deleteFile error:`, err);
    }
  }
}
