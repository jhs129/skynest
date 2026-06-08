import { describe, it, expect } from 'vitest';
import { buildMeetingDocument } from './document';
import type { ReadAiPayload, HaikuAnalysis } from './schema';

const PAYLOAD: ReadAiPayload = {
  request_id: 'req_abc123',
  session_id: 'sess_xyz',
  title: 'Quarterly Review',
  summary: 'Original summary.',
  meeting_date: '2026-06-07T14:00:00Z',
  platform: 'zoom',
  report_url: 'https://app.read.ai/sessions/sess_xyz',
  participants: [
    { name: 'Jane Smith', email: 'jane@acme.com' },
    { name: 'John', email: undefined },
  ],
  topics: ['Roadmap', 'Budget'],
  action_items: ['Send proposal'],
  chapter_summaries: [],
};

const ANALYSIS: HaikuAnalysis = {
  client: 'Acme Corp',
  client_slug: 'acme-corp',
  confidence: 'high',
  tags: ['quarterly-review', 'budget'],
  summary: 'We discussed Q2 roadmap and budget allocation.',
  action_items: ['Send updated proposal to Jane'],
};

describe('buildMeetingDocument', () => {
  it('generates correct document id from session_id', () => {
    const { id } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(id).toBe('meetings/sess_xyz');
  });

  it('sets title combining client and meeting title', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(frontmatter.title).toBe('Acme Corp — Quarterly Review');
  });

  it('sets type to document and status to published', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(frontmatter.type).toBe('document');
    expect(frontmatter.status).toBe('published');
  });

  it('puts meeting fields in metadata', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    const m = frontmatter.metadata!;
    expect(m.document_type).toBe('meeting');
    expect(m.client).toBe('acme-corp');
    expect(m.meeting_date).toBe('2026-06-07T14:00:00Z');
    expect(m.platform).toBe('zoom');
    expect(m.report_url).toBe('https://app.read.ai/sessions/sess_xyz');
    expect(m.request_id).toBe('req_abc123');
    expect(m.source).toBe('readai');
    expect(m.haiku_confidence).toBe('high');
  });

  it('includes participant emails in metadata participants', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    const participants = frontmatter.metadata!.participants as string[];
    expect(participants).toContain('jane@acme.com');
    expect(participants).toContain('John');
  });

  it('includes haiku_error in metadata when present', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, { ...ANALYSIS, haiku_error: true });
    expect(frontmatter.metadata!.haiku_error).toBe(true);
  });

  it('omits haiku_error from metadata when absent', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect('haiku_error' in (frontmatter.metadata ?? {})).toBe(false);
  });

  it('body contains ## Summary with Haiku summary text', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Summary');
    expect(body).toContain('We discussed Q2 roadmap and budget allocation.');
  });

  it('body contains ## Action Items from analysis', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Action Items');
    expect(body).toContain('Send updated proposal to Jane');
  });

  it('body contains ## Topics from payload', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Topics');
    expect(body).toContain('Roadmap');
    expect(body).toContain('Budget');
  });

  it('body contains ## Participants', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Participants');
    expect(body).toContain('jane@acme.com');
  });

  it('uses payload summary when Haiku summary is empty', () => {
    const { body } = buildMeetingDocument(PAYLOAD, { ...ANALYSIS, summary: '' });
    expect(body).toContain('Original summary.');
  });
});
