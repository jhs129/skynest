import type { Frontmatter } from '@promptowl/contextnest-engine';
import type { MeetingInput } from './input';
import type { MeetingAnalysis } from './schema';

type AnalysisWithFlags = MeetingAnalysis & { tagger_error?: boolean };

export interface MeetingDocumentParts {
  id: string;
  frontmatter: Frontmatter;
  body: string;
}

/** Lowercase, strip to the engine tag regex, ensure a leading letter. */
function sanitizeSegment(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) return 'unknown';
  return /^[a-z]/.test(s) ? s : `x-${s}`;
}

function buildDateSlug(input: MeetingInput, analysis: MeetingAnalysis): { date: string; slug: string } {
  const date = input.date && input.date !== 'unknown' ? input.date.slice(0, 10) : 'unknown-date';
  const titleSlug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const clientPart =
    analysis.billing_client.slug !== 'unknown' ? `${sanitizeSegment(analysis.billing_client.slug)}-` : '';
  const slug = `${clientPart}${titleSlug}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return { date, slug };
}

function buildTags(analysis: AnalysisWithFlags): string[] {
  const tags = new Set<string>(['#meetings']);
  tags.add(`#client_${sanitizeSegment(analysis.billing_client.slug)}`);
  if (analysis.end_client) tags.add(`#subclient_${sanitizeSegment(analysis.end_client.slug)}`);
  if (analysis.project) tags.add(`#project_${sanitizeSegment(analysis.project.code)}`);
  for (const t of analysis.topics_canonical) tags.add(`#topic_${sanitizeSegment(t)}`);
  for (const t of analysis.topics_freeform) tags.add(`#${sanitizeSegment(t)}`);
  if (analysis.confidence === 'low' || analysis.tagger_error) tags.add('#needs-review');
  return [...tags];
}

export function buildMeetingDocument(
  input: MeetingInput,
  analysis: AnalysisWithFlags,
  requestId: string,
  readaiId: string,
  reportUrl: string | undefined,
): MeetingDocumentParts {
  const { date, slug } = buildDateSlug(input, analysis);
  const id = `nodes/meetings/${date}-${slug}`;

  const participants = input.participants
    .map((p) => p.email || p.name)
    .filter((v): v is string => !!v);

  const metadataRaw: Record<string, unknown> = {
    document_type: 'meeting',
    client: analysis.billing_client.slug,
    client_name: analysis.billing_client.name,
    subclient: analysis.end_client?.slug,
    subclient_name: analysis.end_client?.name,
    project_code: analysis.project?.code,
    project: analysis.project?.name,
    topics: [...analysis.topics_canonical, ...analysis.topics_freeform],
    meeting_date: input.date !== 'unknown' ? input.date : undefined,
    participants,
    platform: input.platform !== 'unknown' ? input.platform : undefined,
    report_url: reportUrl,
    readai_id: readaiId,
    request_id: requestId,
    source: 'readai',
    tagger_confidence: analysis.confidence,
    ...(analysis.tagger_error ? { tagger_error: true } : {}),
  };
  const metadata = Object.fromEntries(Object.entries(metadataRaw).filter(([, v]) => v !== undefined));

  const titleClient = analysis.billing_client.name !== 'unknown' ? `${analysis.billing_client.name} — ` : '';
  const frontmatter: Frontmatter = {
    title: `${titleClient}${input.title} — ${date}`,
    type: 'document',
    status: 'published',
    tags: buildTags(analysis),
    metadata,
  };

  return { id, frontmatter, body: buildBody(input, analysis) };
}

function buildBody(input: MeetingInput, analysis: MeetingAnalysis): string {
  const lines: string[] = [];
  lines.push('## Summary', '', analysis.summary || input.summary || '', '');

  // Readable client/project names in the body so full-text search finds them.
  const ctx: string[] = [];
  if (analysis.billing_client.name !== 'unknown') ctx.push(`**Client:** ${analysis.billing_client.name}`);
  if (analysis.end_client) ctx.push(`**End client:** ${analysis.end_client.name}`);
  if (analysis.project) ctx.push(`**Project:** ${analysis.project.name} (${analysis.project.code})`);
  if (ctx.length) lines.push('## Context', '', ...ctx, '');

  if (analysis.action_items.length) {
    lines.push('## Action Items', '');
    analysis.action_items.forEach((i) => lines.push(`- ${i}`));
    lines.push('');
  }
  if (input.topics.length) {
    lines.push('## Topics', '');
    input.topics.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  if (input.participants.length) {
    lines.push('## Participants', '');
    input.participants.forEach((p) => {
      const label = p.name && p.email ? `${p.name} (${p.email})` : p.name || p.email || 'unknown';
      lines.push(`- ${label}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}
