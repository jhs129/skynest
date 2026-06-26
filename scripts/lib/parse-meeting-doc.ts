import type { MeetingInput } from '../../src/lib/webhooks/readai/input';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

/** Strip a "Client — Title — YYYY-MM-DD" frontmatter title down to the meeting title. */
function cleanTitle(title: string): string {
  const parts = title.split('—').map((s) => s.trim());
  if (parts.length >= 3) return parts.slice(1, -1).join(' — ');
  if (parts.length === 2) return parts[1];
  return title.trim();
}

export function parseMeetingDoc(title: string, body: string): MeetingInput {
  const emails = Array.from(new Set(body.match(EMAIL_RE) ?? []))
    .filter((e) => !e.includes('read.ai'));
  const dateMatch = body.match(DATE_RE);

  // Summary = text under a "## Summary" heading, else the whole body.
  const summaryMatch = body.match(/##\s*Summary\s*\n([\s\S]*?)(\n##\s|\n#\s|$)/i);
  const summary = (summaryMatch ? summaryMatch[1] : body).trim();

  return {
    title: cleanTitle(title),
    date: dateMatch ? `${dateMatch[1]}T00:00:00Z` : 'unknown',
    platform: 'unknown',
    participants: emails.map((email) => ({ name: '', email })),
    // Pass the whole body as topical context so the tagger has full signal.
    summary: summary || body.trim(),
    topics: [],
    actionItems: [],
    chapters: [],
  };
}
