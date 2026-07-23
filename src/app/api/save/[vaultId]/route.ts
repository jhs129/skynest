import { NextResponse } from 'next/server';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { createEngine } from '@/lib/vault/index';
import { validateVaultId } from '@/lib/vault/storage/index';
import {
  publishDocument,
  serializeDocument,
  validateDocument,
} from '@promptowl/contextnest-engine';
import type { Frontmatter } from '@promptowl/contextnest-engine';

type Params = { params: Promise<{ vaultId: string }> };

/**
 * Flat plain-JSON UPSERT facade over the SAME auth + storage as the MCP
 * `create_document`/`update_document` tools — the write-side sibling of
 * /api/read and /api/list (same rationale: Copilot Studio direct connector
 * tools can neither build the nested JSON-RPC body nor parse the MCP SSE
 * response). One call creates the document if missing, or updates it if it
 * exists, and can set status in the same write — so the Interview Agent
 * needs a single "save + publish" tool per section. Additive — the MCP
 * endpoint is untouched.
 *
 * POST /api/save/{vaultId}
 *   body: { "uri": "sections/day-one", "title": "Day One",
 *           "body": "…narrative…", "status": "published" }
 *   -> { id, status, version, created }
 *
 * Requires mcp:write scope (fail-closed 403 otherwise) — attribution flows
 * to the blob hash chain via the authenticated user, same as the MCP tools.
 */
export async function POST(req: Request, { params }: Params) {
  const { vaultId } = await params;
  validateVaultId(vaultId);

  const resourceUrl = `${new URL(req.url).origin}/api/mcp`;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const authInfo = await verifyMcpToken(bearer, resourceUrl);
  if (!authInfo) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopes: string[] = (authInfo as { scopes?: string[] }).scopes ?? [];
  if (!scopes.includes('mcp:write')) {
    return NextResponse.json(
      { error: 'Insufficient permissions: write access to this vault is required.' },
      { status: 403 },
    );
  }

  const payload = (await req.json().catch(() => ({}))) as {
    uri?: string;
    title?: string;
    body?: string;
    status?: string;
  };
  const { uri, title } = payload;
  if (typeof uri !== 'string' || uri.length === 0) {
    return NextResponse.json({ error: 'Missing required property "uri"' }, { status: 400 });
  }
  if (typeof title !== 'string' || title.length === 0) {
    return NextResponse.json({ error: 'Missing required property "title"' }, { status: 400 });
  }
  const status = payload.status === 'published' ? 'published' : 'draft';
  const narrative = typeof payload.body === 'string' ? payload.body : '';

  const { userToken, userLogin } = authInfo.extra as { userToken: string; userLogin?: string };
  const { storage, sync } = createEngine(userToken, vaultId);
  const id = uri.replace(/\.md$/, '');
  const editedBy = userLogin ?? 'mcp@contextnest.hosted';

  let doc;
  let created = false;
  try {
    doc = await storage.readDocument(id);
    doc.frontmatter.title = title;
    doc.frontmatter.status = status;
    doc.frontmatter.updated_at = new Date().toISOString();
    if (narrative) doc.body = `\n${narrative}\n`;
  } catch {
    created = true;
    const frontmatter: Frontmatter = {
      title,
      type: 'document',
      status,
      created_at: new Date().toISOString(),
    };
    doc = {
      id,
      filePath: '',
      frontmatter,
      body: narrative ? `\n${narrative}\n` : `\n# ${title}\n\n`,
      rawContent: '',
    };
  }

  const validation = validateDocument(doc);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Validation failed', errors: validation.errors },
      { status: 400 },
    );
  }

  const content = serializeDocument(doc);
  await storage.writeDocument(id, content);

  let result;
  try {
    result = await publishDocument(storage, id, {
      editedBy,
      note: created ? 'Created via save facade' : 'Updated via save facade',
    });
  } catch (err) {
    if (created) {
      try {
        await storage.deleteDocument(id);
      } catch {
        // best-effort cleanup
      }
    }
    throw err;
  }

  await storage.regenerateIndex();

  await sync.commitFile({
    path: `${id}.md`,
    content: Buffer.from(content, 'utf-8'),
    message: `${created ? 'create' : 'update'} ${id}`,
    editedBy,
    userToken,
  });

  return NextResponse.json({
    id: result.node.id,
    status: result.node.frontmatter.status,
    version: result.node.frontmatter.version,
    created,
  });
}
