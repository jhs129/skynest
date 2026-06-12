export type RepoAccess = 'write' | 'read' | 'none';

/**
 * Checks the authenticated user's permission level on a GitHub repo.
 * Returns 'write' (push/admin), 'read' (pull only), or 'none' (no access / not found).
 */
export async function checkRepoAccess(userToken: string, repo: string): Promise<RepoAccess> {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return 'none';

  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (res.status === 404 || res.status === 403) return 'none';
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
