import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createStorageProvider } from '@/lib/vault/storage/index';

interface GitTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

interface GitBlobResponse {
  content: string;
}

async function fetchGitTree(repo: string, branch: string, token: string): Promise<GitTreeEntry[]> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } },
  );
  if (!res.ok) throw new Error(`GitHub trees API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { tree: GitTreeEntry[]; truncated: boolean };
  if (data.truncated) console.warn('[sync-from-git] Tree was truncated — some files may be missing');
  return data.tree.filter(e => e.type === 'blob');
}

async function fetchBlob(repo: string, sha: string, token: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/git/blobs/${sha}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } },
  );
  if (!res.ok) throw new Error(`GitHub blob API ${res.status} for sha ${sha}`);
  const data = await res.json() as GitBlobResponse;
  return Buffer.from(data.content.replace(/\n/g, ''), 'base64');
}

/**
 * Resolve the GitHub token to use for pulling the vault repo.
 *
 * Priority:
 *  1. VAULT_GITHUB_ADMIN_TOKEN env var (headless/admin bootstrap)
 *  2. Authorization: Bearer <token> header treated as a raw GitHub token
 *  3. Active NextAuth session with a GitHub access token (browser flow)
 */
async function resolveGitHubToken(req: NextRequest): Promise<string | null> {
  // 1. Env-var admin token (e.g. set once in Vercel dashboard for headless sync)
  if (process.env.VAULT_GITHUB_ADMIN_TOKEN) {
    return process.env.VAULT_GITHUB_ADMIN_TOKEN;
  }

  // 2. Raw GitHub token passed directly in the Authorization header
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (bearer && bearer.startsWith('gh')) {
    return bearer;
  }

  // 3. NextAuth session (browser sign-in flow)
  const session = await auth();
  const sessionToken = (session as { githubAccessToken?: string } | null)?.githubAccessToken;
  return sessionToken ?? null;
}

export async function POST(req: NextRequest) {
  const repo = process.env.VAULT_REPO;
  const branch = process.env.VAULT_BRANCH ?? 'main';
  if (!repo) {
    return NextResponse.json({ error: 'VAULT_REPO env var not set' }, { status: 500 });
  }

  const githubToken = await resolveGitHubToken(req);
  if (!githubToken) {
    return NextResponse.json(
      { error: 'No GitHub token available. Set VAULT_GITHUB_ADMIN_TOKEN, pass a GitHub token as Authorization: Bearer, or sign in via browser.' },
      { status: 401 },
    );
  }

  const storage = createStorageProvider();

  let blobs: GitTreeEntry[];
  try {
    blobs = await fetchGitTree(repo, branch, githubToken);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  const results = { imported: 0, failed: 0, errors: [] as string[] };

  for (const blob of blobs) {
    try {
      const content = await fetchBlob(repo, blob.sha, githubToken);
      await storage.write(blob.path, content);
      results.imported++;
    } catch (err) {
      console.error(`[sync-from-git] Failed: ${blob.path}`, err);
      results.failed++;
      results.errors.push(`${blob.path}: ${String(err)}`);
    }
  }

  return NextResponse.json({ ok: true, repo, branch, ...results });
}
