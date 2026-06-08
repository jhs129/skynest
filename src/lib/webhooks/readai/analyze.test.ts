import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReadAiPayload } from './schema';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/gateway', () => ({
  createGateway: vi.fn(() => vi.fn()),
}));

import { generateText } from 'ai';
import { analyzeMeeting } from './analyze';

const mockGenerateText = vi.mocked(generateText);

const PAYLOAD: ReadAiPayload = {
  request_id: 'req_1',
  session_id: 'sess_1',
  title: 'Quarterly Review',
  summary: 'We discussed roadmap.',
  start_time: '2026-06-07T14:00:00Z',
  platform: 'zoom',
  report_url: 'https://app.read.ai/sessions/sess_1',
  participants: [{ name: 'Jane Smith', email: 'jane@acme.com' }],
  topics: [{ text: 'Roadmap' }],
  action_items: [{ text: 'Send proposal' }],
  key_questions: [],
  chapter_summaries: [],
};

const VALID_RESPONSE = JSON.stringify({
  client: 'Acme Corp',
  client_slug: 'acme-corp',
  confidence: 'high',
  tags: ['quarterly-review'],
  summary: 'Met to discuss Q2 roadmap.',
  action_items: ['Send proposal'],
});

describe('analyzeMeeting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_AI_GATEWAY_KEY = 'test-key';
  });

  it('returns parsed analysis for valid Haiku response', async () => {
    mockGenerateText.mockResolvedValue({ text: VALID_RESPONSE } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);
    const result = await analyzeMeeting(PAYLOAD, '## Clients\n### Acme Corp');
    expect(result.client).toBe('Acme Corp');
    expect(result.client_slug).toBe('acme-corp');
    expect(result.confidence).toBe('high');
    expect(result.haiku_error).toBeUndefined();
  });

  it('returns unknown client when Haiku response is not parseable JSON', async () => {
    mockGenerateText.mockResolvedValue({ text: 'not json at all' } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);
    const result = await analyzeMeeting(PAYLOAD, '');
    expect(result.client_slug).toBe('unknown');
    expect(result.haiku_error).toBe(true);
  });

  it('returns unknown client when Zod validation fails', async () => {
    mockGenerateText.mockResolvedValue({ text: '{"client":"Acme","client_slug":"acme","confidence":"very-high","tags":[],"summary":"","action_items":[]}' } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);
    const result = await analyzeMeeting(PAYLOAD, '');
    expect(result.client_slug).toBe('unknown');
    expect(result.haiku_error).toBe(true);
  });

  it('forces client to unknown (lowercase) when confidence is low', async () => {
    const lowConf = JSON.stringify({
      client: 'Maybe Corp',
      client_slug: 'maybe-corp',
      confidence: 'low',
      tags: [],
      summary: 'Unclear meeting.',
      action_items: [],
    });
    mockGenerateText.mockResolvedValue({ text: lowConf } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);
    const result = await analyzeMeeting(PAYLOAD, '');
    expect(result.client).toBe('unknown');
    expect(result.client_slug).toBe('unknown');
    expect(result.haiku_error).toBeUndefined();
  });

  it('returns unknown with haiku_error when generateText throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('API down'));
    const result = await analyzeMeeting(PAYLOAD, '');
    expect(result.client_slug).toBe('unknown');
    expect(result.haiku_error).toBe(true);
  });

  it('includes registry text and payload fields in the prompt', async () => {
    mockGenerateText.mockResolvedValue({ text: VALID_RESPONSE } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);
    await analyzeMeeting(PAYLOAD, '### Special Client\n- domains: special.com');
    const call = mockGenerateText.mock.calls[0][0];
    expect(call.prompt).toContain('Special Client');
    expect(call.prompt).toContain('Quarterly Review');
    expect(call.prompt).toContain('Roadmap');
    expect(call.prompt).toContain('Send proposal');
  });
});
