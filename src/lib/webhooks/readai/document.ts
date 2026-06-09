import type { Frontmatter } from '@promptowl/contextnest-engine';
import type { ReadAiPayload, HaikuAnalysis } from './schema';

export interface MeetingDocumentParts {
  id: string;
  frontmatter: Frontmatter;
  body: string;
}

function buildDateSlug(payload: ReadAiPayload, analysis: HaikuAnalysis): { date: string; slug: string } {
  const date = payload.start_time
    ? payload.start_time.slice(0, 10)
    : 'unknown-date';

  const titleSlug = payload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const clientPart = analysis.client_slug !== 'unknown' ? `${analysis.client_slug}-` : '';
  const slug = `${clientPart}${titleSlug}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '');

  return { date, slug };
}

export function buildMeetingDocument(
  payload: ReadAiPayload,
  analysis: HaikuAnalysis & { haiku_error?: boolean },
): MeetingDocumentParts {
  const { date, slug } = buildDateSlug(payload, analysis);
  const id = `nodes/meetings/${date}-${slug}`;

  const participants = payload.participants
    .map((p) => p.email || p.name)
    .filter((v): v is string => Boolean(v));

  const metadataRaw: Record<string, unknown> = {
    document_type: 'meeting',
    client: analysis.client_slug,
    meeting_date: payload.start_time,
    participants,
    platform: payload.platform,
    report_url: payload.report_url,
    request_id: payload.request_id,
    source: 'readai',
    haiku_confidence: analysis.confidence,
    ...(analysis.haiku_error ? { haiku_error: true } : {}),
  };
  // gray-matter/js-yaml throws on undefined values — strip them
  const metadata: Record<string, unknown> = Object.fromEntries(
    Object.entries(metadataRaw).filter(([, v]) => v !== undefined),
  );

  const frontmatter: Frontmatter = {
    title: `${analysis.client} — ${payload.title} — ${date}`,
    type: 'document',
    status: 'published',
    tags: analysis.tags,
    metadata,
  };

  return { id, frontmatter, body: buildBody(payload, analysis) };
}

function buildBody(
  payload: ReadAiPayload,
  analysis: HaikuAnalysis & { haiku_error?: boolean },
): string {
  const lines: string[] = [];

  lines.push('## Summary', '', analysis.summary || payload.summary || '', '');

  if (analysis.action_items.length > 0) {
    lines.push('## Action Items', '');
    analysis.action_items.forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }

  if (payload.topics.length > 0) {
    lines.push('## Topics', '');
    payload.topics.forEach((t) => lines.push(`- ${t.text}`));
    lines.push('');
  }

  if (payload.participants.length > 0) {
    lines.push('## Participants', '');
    payload.participants.forEach((p) => {
      const label =
        p.name && p.email
          ? `${p.name} (${p.email})`
          : p.name || p.email || 'unknown';
      lines.push(`- ${label}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
