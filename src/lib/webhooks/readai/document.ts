import type { Frontmatter } from '@promptowl/contextnest-engine';
import type { ReadAiPayload, HaikuAnalysis } from './schema';

export interface MeetingDocumentParts {
  id: string;
  frontmatter: Frontmatter;
  body: string;
}

export function buildMeetingDocument(
  payload: ReadAiPayload,
  analysis: HaikuAnalysis & { haiku_error?: boolean },
): MeetingDocumentParts {
  const id = `meetings/${payload.session_id}`;

  const participants = payload.participants
    .map((p) => p.email || p.name)
    .filter((v): v is string => Boolean(v));

  const metadata: Record<string, unknown> = {
    document_type: 'meeting',
    client: analysis.client_slug,
    meeting_date: payload.meeting_date,
    participants,
    platform: payload.platform,
    report_url: payload.report_url,
    request_id: payload.request_id,
    source: 'readai',
    haiku_confidence: analysis.confidence,
  };

  if (analysis.haiku_error) {
    metadata.haiku_error = true;
  }

  const frontmatter: Frontmatter = {
    title: `${analysis.client} — ${payload.title}`,
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
    payload.topics.forEach((topic) => lines.push(`- ${topic}`));
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
