import type { AuthorizationProvider } from './authorization-provider.js';
import { GitHubAuthorizationProvider } from './providers/github-authorization-provider.js';
import { EntraAuthorizationProvider } from './providers/entra-authorization-provider.js';

// AUTHZ_ENTRA_{WRITE,READ}_GROUP_ID each accept one or more Entra group
// object IDs, comma-separated (e.g. both CareTeam and LED granting write).
function parseGroupIds(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function createAuthorizationProvider(): AuthorizationProvider {
  const authProvider = process.env.AUTH_PROVIDER ?? 'github';

  if (authProvider === 'entra') {
    return new EntraAuthorizationProvider({
      writeGroupIds: parseGroupIds(process.env.AUTHZ_ENTRA_WRITE_GROUP_ID),
      readGroupIds: parseGroupIds(process.env.AUTHZ_ENTRA_READ_GROUP_ID),
    });
  }

  const repo = process.env.AUTHZ_GITHUB_REPO;
  if (!repo) {
    throw new Error('AUTHZ_GITHUB_REPO env var is required when AUTH_PROVIDER=github');
  }
  return new GitHubAuthorizationProvider({ repo });
}
