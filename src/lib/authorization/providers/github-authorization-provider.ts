import type {
  AuthorizationLevel,
  AuthorizationProvider,
  AuthorizationIdentity,
} from '../authorization-provider.js';

export interface GitHubAuthorizationProviderConfig {
  repo: string;
}

export class GitHubAuthorizationProvider implements AuthorizationProvider {
  constructor(private readonly config: GitHubAuthorizationProviderConfig) {}

  async checkAccess(identity: AuthorizationIdentity): Promise<AuthorizationLevel> {
    const res = await fetch(`https://api.github.com/repos/${this.config.repo}`, {
      headers: {
        Authorization: `Bearer ${identity.idpAccessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) return 'none';

    const data = (await res.json()) as {
      permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
    };

    const perms = data.permissions;
    if (!perms) return 'none';
    if (perms.admin || perms.push) return 'write';
    if (perms.pull) return 'read';
    return 'none';
  }
}
