import { NextResponse } from 'next/server';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { createEngine } from '@/lib/vault/index';
import { validateVaultId } from '@/lib/vault/storage/index';

type Params = { params: Promise<{ vaultId: string }> };

/**
 * Flat plain-JSON list facade over the SAME auth + storage as the MCP `list_documents` tool.
 * See ./read for why the flat facade exists (Power Fx nested-body + SSE walls on direct tools).
 *
 * POST /api/list/{vaultId}   body: { "status": "published" }   (all filters optional)
 *   -> [ { id, title, type, status, tags } ]
 */
export async function POST(req: Request, { params }: Params) {
  const { vaultId } = await params;
  validateVaultId(vaultId);

  const resourceUrl = `${new URL(req.url).origin}/api/mcp`;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const authInfo = await verifyMcpToken(bearer, resourceUrl);
  if (!authInfo) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const filters = (await req.json().catch(() => ({}))) as {
    type?: string;
    status?: string;
    tag?: string;
  };

  const { userToken } = authInfo.extra as { userToken: string };
  const { storage } = createEngine(userToken, vaultId);
  let docs = await storage.discoverDocuments();
  if (filters.type) docs = docs.filter((d) => (d.frontmatter.type ?? 'document') === filters.type);
  if (filters.status)
    docs = docs.filter((d) => (d.frontmatter.status ?? 'draft') === filters.status);
  if (filters.tag) {
    const normalizedTag = filters.tag.startsWith('#') ? filters.tag : `#${filters.tag}`;
    docs = docs.filter((d) => d.frontmatter.tags?.includes(normalizedTag));
  }

  return NextResponse.json(
    docs.map((d) => ({
      id: d.id,
      title: d.frontmatter.title,
      type: d.frontmatter.type ?? 'document',
      status: d.frontmatter.status ?? 'draft',
      tags: d.frontmatter.tags,
    })),
  );
}
