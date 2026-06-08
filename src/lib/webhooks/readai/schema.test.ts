import { describe, it, expect } from 'vitest';
import { ReadAiPayloadSchema } from './schema';

const VALID_PAYLOAD = {
  request_id: 'req_abc123',
  session_id: 'ses_abc123',
  title: 'Quarterly Review',
  trigger: 'meeting_end',
  summary: 'We discussed the quarterly results.',
  start_time: '2026-06-07T14:00:00Z',
  end_time: '2026-06-07T15:00:00Z',
  platform: 'zoom',
  report_url: 'https://app.read.ai/analytics/meetings/abc123',
  participants: [
    { name: 'Jane Smith', first_name: 'Jane', last_name: 'Smith', email: 'jane@acme.com' },
    { name: 'John Schneider', first_name: 'John', last_name: 'Schneider', email: null },
  ],
  topics: [{ text: 'quarterly review' }, { text: 'roadmap' }],
  action_items: [{ text: 'Follow up on contract renewal by June 30' }],
  key_questions: [{ text: 'What is the Q3 budget?' }],
  chapter_summaries: [{ title: 'Intro', description: 'Introductions and agenda.', topics: [] }],
};

describe('ReadAiPayloadSchema', () => {
  it('accepts a valid payload', () => {
    const result = ReadAiPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('accepts payload with only required fields', () => {
    const minimal = {
      request_id: 'req_abc123',
      session_id: 'ses_abc123',
      title: 'Meeting',
    };
    const result = ReadAiPayloadSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('defaults optional arrays to empty arrays', () => {
    const minimal = { request_id: 'req_1', session_id: 'ses_1', title: 'Meeting' };
    const result = ReadAiPayloadSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.participants).toEqual([]);
      expect(result.data.topics).toEqual([]);
      expect(result.data.action_items).toEqual([]);
      expect(result.data.chapter_summaries).toEqual([]);
    }
  });

  it('accepts participant with null email', () => {
    const payload = { ...VALID_PAYLOAD, participants: [{ name: 'Speaker', email: null }] };
    const result = ReadAiPayloadSchema.safeParse(payload);
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

  it('handles extra unknown fields gracefully', () => {
    const withExtra = { ...VALID_PAYLOAD, unknown_field: 'extra', platform_meeting_id: 'abc-def' };
    const result = ReadAiPayloadSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
  });

  it('rejects chapter_summaries with missing description', () => {
    const payload = {
      ...VALID_PAYLOAD,
      chapter_summaries: [{ title: 'Intro' }],
    };
    const result = ReadAiPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
