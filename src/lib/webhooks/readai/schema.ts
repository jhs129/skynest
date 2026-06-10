import { z } from 'zod';

const PersonSchema = z.object({
  name: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

const TranscriptSpeakerBlockSchema = z.object({
  // docs say string but real payloads send numbers
  start_time: z.union([z.string(), z.number()]),
  end_time: z.union([z.string(), z.number()]),
  speaker: z.object({ name: z.string() }),
  words: z.string(),
});

const TranscriptSchema = z.object({
  speaker_blocks: z.array(TranscriptSpeakerBlockSchema).optional().default([]),
  speakers: z.array(z.object({ name: z.string() })).optional().default([]),
});

const TextItemSchema = z.object({ text: z.string() });

// Read.ai sends chapter topics as plain strings, not {text} objects
const ChapterTopicSchema = z.union([z.string(), TextItemSchema]);

const ChapterSummarySchema = z.object({
  title: z.string(),
  description: z.string().optional().default(''),
  topics: z.array(ChapterTopicSchema).optional().default([]),
});

export const ReadAiPayloadSchema = z.object({
  request_id: z.string(),
  session_id: z.string(),
  title: z.string(),
  trigger: z.string().optional(),
  summary: z.string().optional().default(''),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  participants: z.array(PersonSchema).optional().default([]),
  owner: PersonSchema.optional(),
  action_items: z.array(TextItemSchema).optional().default([]),
  key_questions: z.array(TextItemSchema).optional().default([]),
  topics: z.array(TextItemSchema).optional().default([]),
  report_url: z.string().optional(),
  chapter_summaries: z.array(ChapterSummarySchema).optional().default([]),
  platform: z.string().optional(),
  platform_meeting_id: z.string().optional(),
  transcript: TranscriptSchema.optional(),
});

export type ReadAiPayload = z.infer<typeof ReadAiPayloadSchema>;

const ClientRefSchema = z.object({
  name: z.string(),
  slug: z.string(),
});

export const MeetingAnalysisSchema = z.object({
  billing_client: ClientRefSchema,
  end_client: ClientRefSchema.nullable(),
  project: z.object({ code: z.string(), name: z.string() }).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  topics_canonical: z.array(z.string()),
  topics_freeform: z.array(z.string()).max(2),
  summary: z.string(),
  action_items: z.array(z.string()),
});

export type MeetingAnalysis = z.infer<typeof MeetingAnalysisSchema>;
