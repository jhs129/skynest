import { describe, it, expect } from 'vitest';
import { ReadAiPayloadSchema } from './schema';

const VALID_PAYLOAD = {
  request_id: 'req_abc123',
  session_id: 'ses_abc123',
  title: 'Quarterly Review',
  summary: 'We discussed the quarterly results.',
  meeting_date: '2026-06-07T14:00:00Z',
  duration_minutes: 45,
  platform: 'zoom',
  report_url: 'https://app.read.ai/analytics/sessions/abc123',
  participants: [
    { name: 'Jane Smith', email: 'jane@acme.com' },
    { name: 'John Schneider', email: 'john@jhsconsulting.net' },
  ],
  topics: ['quarterly review', 'roadmap'],
  action_items: ['Follow up on contract renewal by June 30'],
  chapter_summaries: [{ title: 'Intro', summary: 'Introductions.' }],
};

describe('ReadAiPayloadSchema', () => {
  it('accepts a valid payload', () => {
    const result = ReadAiPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('accepts payload with missing optional fields', () => {
    const minimal = {
      request_id: 'req_abc123',
      session_id: 'ses_abc123',
      title: 'Meeting',
      summary: 'A meeting.',
      meeting_date: '2026-06-07T14:00:00Z',
      participants: [],
    };
    const result = ReadAiPayloadSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('rejects payload missing required request_id', () => {
    const { request_id: _, ...without } = VALID_PAYLOAD;
    const result = ReadAiPayloadSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing required session_id', () => {
    const { session_id: _, ...without } = VALID_PAYLOAD;
    const result = ReadAiPayloadSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing required title', () => {
    const { title: _, ...without } = VALID_PAYLOAD;
    const result = ReadAiPayloadSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing required summary', () => {
    const { summary: _, ...without } = VALID_PAYLOAD;
    const result = ReadAiPayloadSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing required meeting_date', () => {
    const { meeting_date: _, ...without } = VALID_PAYLOAD;
    const result = ReadAiPayloadSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects payload missing required participants', () => {
    const { participants: _, ...without } = VALID_PAYLOAD;
    const result = ReadAiPayloadSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('handles extra unknown fields gracefully (strips or accepts)', () => {
    const withExtra = { ...VALID_PAYLOAD, unknown_field: 'extra' };
    const result = ReadAiPayloadSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
  });
});
