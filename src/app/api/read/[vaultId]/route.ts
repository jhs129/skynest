import { NextResponse } from 'next/server';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { createEngine } from '@/lib/vault/index';
import { validateVaultId } from '@/lib/vault/storage/index';
import { parseUri } from '@promptowl/contextnest-engine';

type Params = { params: Promise<{ vaultId: string }> };

/**
 * Flat plain-JSON read facade over the SAME auth + storage as the MCP `read_document` tool.
 *
 * Why this exists: Copilot Studio direct connector tools cannot (a) build the 3-level-nested
 * JSON-RPC request body the MCP endpoint needs (Power Fx "object too complex"), nor (b) parse the
 * MCP endpoint's text/event-stream (SSE) response. This endpoint takes a flat body `{ uri }` and
 * returns plain JSON, so a direct connector tool works. Additive — the MCP endpoint and the write
 * path are untouched.
 *
 * POST /api/read/{vaultId}   body: { "uri": "sections/about-me" }
 *   -> { id, frontmatter, body }
 */
export async function POST(req: Request, { params }: Params) {
  const { vaultId } = await params;
  validateVaultId(vaultId);

  // Tokens are audience'd to /api/mcp regardless of the vault path (matches the MCP route).
  const resourceUrl = `${new URL(req.url).origin}/api/mcp`;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const authInfo = await verifyMcpToken(bearer, resourceUrl);
  if (!authInfo) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { uri?: string };
  const uri = body?.uri;
  if (typeof uri !== 'string' || uri.length === 0) {
    return NextResponse.json({ error: 'Missing required property "uri"' }, { status: 400 });
  }

  const { userToken } = authInfo.extra as { userToken: string };
  const { storage } = createEngine(userToken, vaultId);
  const docId = uri.startsWith('contextnest://') ? parseUri(uri).path : uri.replace(/\.md$/, '');
  const doc = await storage.readDocument(docId);
  return NextResponse.json({ id: doc.id, frontmatter: doc.frontmatter, body: doc.body });
}
