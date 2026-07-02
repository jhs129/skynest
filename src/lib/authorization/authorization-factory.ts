import type { AuthorizationProvider } from './authorization-provider.js';
import { GitHubAuthorizationProvider } from './providers/github-authorization-provider.js';
import { EntraAuthorizationProvider } from './providers/entra-authorization-provider.js';

export function createAuthorizationProvider(): AuthorizationProvider {
  const authProvider = process.env.AUTH_PROVIDER ?? 'github';

  if (authProvider === 'entra') {
    return new EntraAuthorizationProvider({
      writeGroupId: process.env.AUTHZ_ENTRA_WRITE_GROUP_ID,
      readGroupId: process.env.AUTHZ_ENTRA_READ_GROUP_ID,
    });
  }

  const repo = process.env.AUTHZ_GITHUB_REPO;
  if (!repo) {
    throw new Error('AUTHZ_GITHUB_REPO env var is required when AUTH_PROVIDER=github');
  }
  return new GitHubAuthorizationProvider({ repo });
}
