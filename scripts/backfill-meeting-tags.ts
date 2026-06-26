/**
 * Re-tag existing meeting docs with the production analyzer.
 *
 *   pnpm tsx scripts/backfill-meeting-tags.ts --dry-run            # all meetings -> review report
 *   pnpm tsx scripts/backfill-meeting-tags.ts --dry-run --limit 8  # pilot batch
 *   pnpm tsx scripts/backfill-meeting-tags.ts --apply --only nodes/meetings/2026-06-08-oh-web-scrum
 *   pnpm tsx scripts/backfill-meeting-tags.ts --apply             # rewrite all
 *
 * Requires env (loaded from .env.local): CONTEXTNEST_STORAGE, CONTEXTNEST_BLOB_PREFIX,
 * BLOB_READ_WRITE_TOKEN, CONTEXTNEST_DEFAULT_VAULT_ID, BOT_GITHUB_TOKEN, VAULT_REPO,
 * VAULT_BRANCH, VAULT_SYNC_PROVIDER, and AI Gateway auth (VERCEL_AI_GATEWAY_KEY or VERCEL_OIDC_TOKEN).
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { publishDocument, serializeDocument } from '@promptowl/contextnest-engine';
import { createEngine } from '../src/lib/vault/index';
import { analyzeMeeting } from '../src/lib/webhooks/readai/analyze';
import { buildMeetingDocument } from '../src/lib/webhooks/readai/document';
import { parseMeetingDoc } from './lib/parse-meeting-doc';

loadEnv({ path: '.env.local' });

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run') || !args.includes('--apply');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

async function main() {
  const vaultId = process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default';
  const botToken = process.env.BOT_GITHUB_TOKEN ?? '';
  const { storage, sync } = createEngine(botToken, vaultId);

  const read = async (id: string) => (await storage.readDocument(id))?.rawContent ?? '';
  const knowledge = {
    registry: await read('nodes/clients/harvest-client-project-context'),
    topicVocab: await read('nodes/processes/meeting-topic-vocabulary'),
    examples: await read('nodes/processes/meeting-tagging-examples'),
  };

  const all = await storage.discoverDocuments();
  let meetings = all.filter(
    (d) => d.id.startsWith('nodes/meetings/') && !d.id.endsWith('/overview'),
  );
  if (ONLY) meetings = meetings.filter((d) => d.id === ONLY);
  meetings = meetings.slice(0, LIMIT);

  console.log(`[backfill] ${meetings.length} meetings | mode=${DRY ? 'DRY-RUN' : 'APPLY'}`);

  const report: string[] = [`# Re-tag review — ${meetings.length} meetings\n`];

  for (const doc of meetings) {
    const title = String(doc.frontmatter.title ?? doc.id);
    const input = parseMeetingDoc(title, doc.body);
    const analysis = await analyzeMeeting(input, knowledge);
    const built = buildMeetingDocument(
      input,
      analysis,
      String(doc.frontmatter?.metadata?.['request_id'] ?? `backfill-${doc.id}`),
      String(doc.frontmatter?.metadata?.['readai_id'] ?? ''),
      doc.frontmatter?.metadata?.['report_url'] as string | undefined,
    );

    const before = (doc.frontmatter.tags ?? []).join(' ');
    const after = (built.frontmatter.tags ?? []).join(' ');
    report.push(
      `## ${doc.id}`,
      `- **was:** ${before || '(none)'}`,
      `- **now:** ${after}`,
      `- **client:** ${analysis.billing_client.name}` +
        (analysis.end_client ? ` / end: ${analysis.end_client.name}` : '') +
        (analysis.project ? ` | project: ${analysis.project.name} (${analysis.project.code})` : '') +
        ` | conf: ${analysis.confidence}`,
      '',
    );
    console.log(`  ${analysis.confidence.padEnd(6)} ${doc.id} -> ${after}`);

    if (!DRY) {
      // Preserve the original body; only re-tag. Rewrite frontmatter at the SAME id.
      const node = {
        id: doc.id, filePath: '', frontmatter: built.frontmatter,
        body: doc.body, rawContent: '',
      };
      const content = serializeDocument(node);
      await storage.writeDocument(doc.id, content);
      await publishDocument(storage, doc.id, { editedBy: 'skynest-bot', note: 'Re-tag: client/project/topic backfill' });
      await sync.commitFile({
        path: `${doc.id}.md`, content: Buffer.from(content, 'utf-8'),
        message: `retag: ${doc.id}`, userToken: botToken,
      });
      // Pace commits so a 50+ file backfill doesn't trip GitHub's secondary
      // (abuse) rate limit. commitFile retries on a throttle, but spacing the
      // PUTs out keeps retries rare rather than the steady state.
      await new Promise((r) => setTimeout(r, 750));
    }
  }

  if (!DRY) await storage.regenerateIndex();

  if (DRY) {
    mkdirSync('docs/superpowers/reviews', { recursive: true });
    const out = `docs/superpowers/reviews/retag-${new Date().toISOString().slice(0, 10)}.md`;
    writeFileSync(out, report.join('\n'));
    console.log(`[backfill] dry-run report -> ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
