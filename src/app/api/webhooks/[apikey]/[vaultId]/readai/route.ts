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
  console.log('[skynest] readai payload', JSON.stringify(payload, null, 2));

  // Initialize vault engine with bot identity
  const botToken = process.env.BOT_GITHUB_TOKEN ?? '';
  console.log(`[skynest] step: createEngine vault=${resolvedVaultId} hasToken=${!!botToken} syncProvider=${process.env.VAULT_SYNC_PROVIDER ?? 'github'} repo=${process.env.VAULT_REPO ?? '(unset)'}`);
  const { storage, sync } = createEngine(botToken, resolvedVaultId);

  // Step 3: Deduplication
  console.log(`[skynest] step: dedup check request_id=${payload.request_id}`);
  if (await isDuplicate(storage, payload.request_id)) {
    console.log(`[skynest] step: duplicate, skipping`);
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  // Read client registry (missing registry is non-fatal)
  console.log(`[skynest] step: read registry`);
  let registryText = '';
  try {
    const registryNode = await storage.readDocument('clients/registry');
    if (registryNode) registryText = registryNode.rawContent;
  } catch {
    // proceed with empty registry
  }

  // Haiku analysis (failure is non-fatal — document is always written)
  console.log(`[skynest] step: analyze meeting`);
  const analysis = await analyzeMeeting(payload, registryText);
  console.log(`[skynest] step: analyze ok haiku_error=${(analysis as { haiku_error?: boolean }).haiku_error ?? false}`);

  // Build document
  console.log(`[skynest] step: build document`);
  const { id, frontmatter, body } = buildMeetingDocument(payload, analysis);
  const node = {
    id,
    filePath: '',
    frontmatter,
    body: `\n${body}\n`,
    rawContent: '',
  };
  const content = serializeDocument(node);
  console.log(`[skynest] step: document built id=${id}`);

  // Write to vault — throws on failure → 500 → triggers Read.ai retry
  try {
    console.log(`[skynest] step: writeDocument`);
    await storage.writeDocument(id, content);
    console.log(`[skynest] step: publishDocument`);
    await publishDocument(storage, id, {
      editedBy: 'skynest-bot',
      note: 'Ingested via Read.ai webhook',
    });
    console.log(`[skynest] step: regenerateIndex`);
    await storage.regenerateIndex();
    console.log(`[skynest] vault write ok vault=${resolvedVaultId} doc=${id} session=${payload.session_id}`);
  } catch (err) {
    console.error('Vault write failed:', err);
    return NextResponse.json({ error: 'vault write failed' }, { status: 500 });
  }

  // Fire-and-forget git sync
  console.log(`[skynest] step: commitFile path=${id}.md`);
  sync
    .commitFile({
      path: `${id}.md`,
      content: Buffer.from(content, 'utf-8'),
      message: `ingest: meeting ${payload.session_id}`,
      userToken: botToken,
    })
    .then(() => console.log(`[skynest] git sync ok vault=${resolvedVaultId} doc=${id}`))
    .catch((err) => console.error(`[skynest] git sync failed:`, err));

  return NextResponse.json({ ok: true }, { status: 200 });
}
