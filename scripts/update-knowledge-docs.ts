/**
 * Persist the 3 tagger knowledge docs through the engine storage layer.
 *
 * The hosted skynest MCP `update_document` tool silently no-ops body writes
 * (bumps version + returns "published" but the body never changes). This script
 * bypasses it and writes via the same path the backfill --apply uses:
 *   serializeDocument -> storage.writeDocument -> publishDocument -> sync.commitFile
 *
 *   pnpm tsx scripts/update-knowledge-docs.ts
 *
 * Bodies are read from scripts/_kd/{registry,vocab,examples}.md.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { publishDocument, serializeDocument } from '@promptowl/contextnest-engine';
import { createEngine } from '../src/lib/vault/index';

loadEnv({ path: '.env.local' });

const DOCS = [
  { id: 'nodes/clients/harvest-client-project-context', body: 'scripts/_kd/registry.md' },
  { id: 'nodes/processes/meeting-topic-vocabulary', body: 'scripts/_kd/vocab.md' },
  { id: 'nodes/processes/meeting-tagging-examples', body: 'scripts/_kd/examples.md' },
];

async function main() {
  const vaultId = process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default';
  const botToken = process.env.BOT_GITHUB_TOKEN ?? '';
  const { storage, sync } = createEngine(botToken, vaultId);

  for (const { id, body: bodyPath } of DOCS) {
    const existing = await storage.readDocument(id);
    if (!existing) {
      console.error(`  MISSING ${id} — skipping`);
      continue;
    }
    const body = readFileSync(bodyPath, 'utf-8');
    const node = {
      id, filePath: '', frontmatter: existing.frontmatter,
      body, rawContent: '',
    };
    const content = serializeDocument(node);
    await storage.writeDocument(id, content);
    await publishDocument(storage, id, {
      editedBy: 'skynest-bot',
      note: 'Encode QA feedback: client-id rules, aliases, recruiting topic',
    });
    await sync.commitFile({
      path: `${id}.md`, content: Buffer.from(content, 'utf-8'),
      message: `docs: encode tagger QA feedback into ${id}`, userToken: botToken,
    });
    console.log(`  wrote ${id} (${body.length} bytes)`);
  }

  await storage.regenerateIndex();
  console.log('[update-knowledge-docs] done; index regenerated');
}

main().catch((e) => { console.error(e); process.exit(1); });
