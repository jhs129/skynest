import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import {
  publishDocument,
  serializeDocument,
} from '@promptowl/contextnest-engine';
import { createEngine } from '@/lib/vault/index';
import { verifyReadAiSignature } from '@/lib/webhooks/readai/verify';
import { ReadAiPayloadSchema } from '@/lib/webhooks/readai/schema';
import { isDuplicate } from '@/lib/webhooks/readai/dedup';
import { analyzeMeeting } from '@/lib/webhooks/readai/analyze';
import { buildMeetingDocument } from '@/lib/webhooks/readai/document';

export const maxDuration = 60;

const VAULT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

interface RouteContext {
  params: Promise<{ apikey: string; vaultId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { apikey, vaultId: rawVaultId } = await params;

  // Step 1: Path key check (timing-safe)
  const webhookApiKey = process.env.WEBHOOK_API_KEY ?? '';
  if (
    apikey.length !== webhookApiKey.length ||
    !timingSafeEqual(Buffer.from(apikey), Buffer.from(webhookApiKey))
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Step 1a: Vault ID validation
  const resolvedVaultId =
    rawVaultId === 'default'
      ? (process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default')
      : rawVaultId;
  if (!VAULT_ID_RE.test(resolvedVaultId)) {
    return NextResponse.json({ error: 'invalid vault id' }, { status: 400 });
  }

  // Step 2: HMAC-SHA256 body verification
  const rawBody = await req.text();
  const signature = req.headers.get('x-read-signature') ?? '';
  const signingKey = process.env.READ_AI_SIGNING_KEY ?? '';
  if (!verifyReadAiSignature(rawBody, signature, signingKey)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Parse payload
  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = ReadAiPayloadSchema.safeParse(jsonBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  const payload = parsed.data;

  // Initialize vault engine with bot identity
  const botToken = process.env.BOT_GITHUB_TOKEN ?? '';
  const { storage, sync } = createEngine(botToken, resolvedVaultId);

  // Step 3: Deduplication
  if (await isDuplicate(storage, payload.request_id)) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  // Read client registry (missing registry is non-fatal)
  let registryText = '';
  try {
    const registryNode = await storage.readDocument('clients/registry');
    if (registryNode) registryText = registryNode.rawContent;
  } catch {
    // proceed with empty registry
  }

  // Haiku analysis (failure is non-fatal — document is always written)
  const analysis = await analyzeMeeting(payload, registryText);

  // Build document
  const { id, frontmatter, body } = buildMeetingDocument(payload, analysis);
  const node = {
    id,
    filePath: '',
    frontmatter,
    body: `\n${body}\n`,
    rawContent: '',
  };
  const content = serializeDocument(node);

  // Write to vault — throws on failure → 500 → triggers Read.ai retry
  try {
    await storage.writeDocument(id, content);
    await publishDocument(storage, id, {
      editedBy: 'skynest-bot',
      note: 'Ingested via Read.ai webhook',
    });
    await storage.regenerateIndex();
    console.log(`[skynest] vault write ok vault=${resolvedVaultId} doc=${id} session=${payload.session_id}`);
  } catch (err) {
    console.error('Vault write failed:', err);
    return NextResponse.json({ error: 'vault write failed' }, { status: 500 });
  }

  // Fire-and-forget git sync
  sync
    .commitFile({
      path: `${id}.md`,
      content: Buffer.from(content, 'utf-8'),
      message: `ingest: meeting ${payload.session_id}`,
      userToken: botToken,
    })
    .then(() => console.log(`[skynest] git sync ok vault=${resolvedVaultId} doc=${id}`))
    .catch(console.error);

  return NextResponse.json({ ok: true }, { status: 200 });
}
