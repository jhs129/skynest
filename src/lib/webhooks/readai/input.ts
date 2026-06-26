import type { ReadAiPayload } from './schema';

export interface MeetingInput {
  title: string;
  date: string;
  platform: string;
  participants: { name: string; email: string }[];
  summary: string;
  topics: string[];
  actionItems: string[];
  chapters: { title: string; description: string }[];
}

export function fromReadAiPayload(payload: ReadAiPayload): MeetingInput {
  return {
    title: payload.title || '(untitled)',
    date: payload.start_time || 'unknown',
    platform: payload.platform || 'unknown',
    participants: payload.participants.map((p) => ({
      name: p.name ?? '',
      email: p.email ?? '',
    })),
    summary: payload.summary || '',
    topics: payload.topics.map((t) => t.text),
    actionItems: payload.action_items.map((a) => a.text),
    chapters: payload.chapter_summaries.map((c) => ({
      title: c.title || '',
      description: c.description || '',
    })),
  };
}
