import { z } from 'zod';

const PersonSchema = z.object({
  name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().nullable().optional(),
});

const TextItemSchema = z.object({ text: z.string() });

const ChapterSummarySchema = z.object({
  title: z.string(),
  description: z.string(),
  topics: z.array(TextItemSchema).optional().default([]),
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
});

export type ReadAiPayload = z.infer<typeof ReadAiPayloadSchema>;

export const HaikuAnalysisSchema = z.object({
  client: z.string(),
  client_slug: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  tags: z.array(z.string()),
  summary: z.string(),
  action_items: z.array(z.string()),
});

export type HaikuAnalysis = z.infer<typeof HaikuAnalysisSchema>;
