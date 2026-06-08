import { z } from 'zod';

const ParticipantSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
});

const ChapterSummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
});

export const ReadAiPayloadSchema = z.object({
  request_id: z.string(),
  session_id: z.string(),
  title: z.string(),
  summary: z.string(),
  meeting_date: z.string(),
  duration_minutes: z.number().optional(),
  platform: z.string().optional(),
  report_url: z.string().optional(),
  participants: z.array(ParticipantSchema),
  topics: z.array(z.string()).optional().default([]),
  action_items: z.array(z.string()).optional().default([]),
  chapter_summaries: z.array(ChapterSummarySchema).optional().default([]),
});

export type ReadAiPayload = z.infer<typeof ReadAiPayloadSchema>;
