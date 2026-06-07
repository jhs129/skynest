import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { posix } from 'path';
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

function safePath(p: string): string | null {
  const normalized = posix.normalize(p);
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('..') ||
    normalized.includes('\0') ||
    normalized.includes('\\')
  ) {
    return null;
  }
  return normalized;
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
 * Verify caller is authorized to trigger a vault sync.
 *
 * Accepts either:
 *  1. Active NextAuth session (browser OAuth flow)
 *  2. Authorization: Bearer <VAULT_ADMIN_TOKEN> (headless/curl — compared with
 *     timingSafeEqual to prevent timing attacks)
 *
 * Returns the GitHub token to use for repo access, or null if unauthorized.
 */
async function authorize(req: NextRequest): Promise<{ githubToken: string } | null> {
  // --- Path 1: NextAuth session (browser flow) ---
  const session = await auth();
  const sessionGitHubToken = (session as { githubAccessToken?: string } | null)?.githubAccessToken;
  if (sessionGitHubToken) {
    return { githubToken: sessionGitHubToken };
  }

  // --- Path 2: VAULT_ADMIN_TOKEN header (headless/curl flow) ---
  const adminToken = process.env.VAULT_ADMIN_TOKEN;
  const githubAdminToken = process.env.VAULT_GITHUB_ADMIN_TOKEN;
  if (adminToken && githubAdminToken) {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const provided = Buffer.from(bearer);
    const expected = Buffer.from(adminToken);
    if (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    ) {
      return { githubToken: githubAdminToken };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const auth_result = await authorize(req);
  if (!auth_result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const repo = process.env.VAULT_REPO;
  const branch = process.env.VAULT_BRANCH ?? 'main';
  if (!repo) {
    return NextResponse.json({ error: 'VAULT_REPO env var not set' }, { status: 500 });
  }

  let body: { vaultId?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const vaultId = body.vaultId;

  const storage = createStorageProvider(vaultId);

  let blobs: GitTreeEntry[];
  try {
    blobs = await fetchGitTree(repo, branch, auth_result.githubToken);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  const results = { imported: 0, failed: 0, skipped: 0, errors: [] as string[] };

  for (const blob of blobs) {
    const safe = safePath(blob.path);
    if (!safe) {
      console.warn(`[sync-from-git] Skipping unsafe path: ${blob.path}`);
      results.skipped++;
      continue;
    }
    try {
      const content = await fetchBlob(repo, blob.sha, auth_result.githubToken);
      await storage.write(safe, content);
      results.imported++;
    } catch (err) {
      console.error(`[sync-from-git] Failed: ${safe}`, err);
      results.failed++;
      results.errors.push(`${safe}: ${String(err)}`);
    }
  }

  const resolvedVaultId = vaultId ?? process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default';
  return NextResponse.json({ ok: true, repo, branch, vaultId: resolvedVaultId, ...results });
}
