import { createGateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import { MeetingAnalysisSchema, type MeetingAnalysis } from './schema';
import type { MeetingInput } from './input';

export interface TaggerKnowledge {
  registry: string;
  topicVocab: string;
  examples: string;
}

const UNKNOWN: MeetingAnalysis = {
  billing_client: { name: 'unknown', slug: 'unknown' },
  end_client: null,
  project: null,
  confidence: 'low',
  topics_canonical: [],
  topics_freeform: [],
  summary: '',
  action_items: [],
};

function buildPrompt(input: MeetingInput, knowledge: TaggerKnowledge): string {
  const participants = input.participants
    .map((p) => p.email || p.name || 'unknown')
    .join(', ');
  const topics = input.topics.map((t) => `- ${t}`).join('\n') || '(none)';
  const actionItems = input.actionItems.map((a) => `- ${a}`).join('\n') || '(none)';
  const chapters = input.chapters
    .map((c) => `### ${c.title || '(untitled)'}\n${c.description}`)
    .join('\n\n');

  return `You tag a meeting report by CLIENT, PROJECT, and TOPIC for a knowledge vault.

## Client & Project Registry
Match participant email domains and meeting content to the BILLING client and project.
When the end client differs from who is billed (e.g. ALZ.org under Laughlin Constable,
Georgia Core under Radical Design, Aventiv under Goods & Services), report both.
${knowledge.registry || '(no registry available)'}

## Canonical Topic Vocabulary
Map topics to these slugs FIRST. Add at most two free-form topics for specifics.
${knowledge.topicVocab || '(no vocabulary available)'}

## Tagging Examples & Corrections
${knowledge.examples || '(none)'}

## Meeting Report
Title: ${input.title}
Date: ${input.date}
Platform: ${input.platform}
Participants: ${participants || 'none'}

Summary:
${input.summary || '(none)'}

Topics:
${topics}

Action Items:
${actionItems}

Chapter Summaries:
${chapters || '(none)'}

Return ONLY a JSON object with exactly this structure (no markdown, no prose):
{
  "billing_client": { "name": "Client Name from registry, or 'unknown'", "slug": "kebab-slug-or-unknown" },
  "end_client": { "name": "...", "slug": "..." } or null,
  "project": { "code": "HARVEST_CODE", "name": "Readable Project Name" } or null,
  "confidence": "high" | "medium" | "low",
  "topics_canonical": ["slug-from-vocabulary"],
  "topics_freeform": ["specific-tag"],
  "summary": "2-3 sentence summary",
  "action_items": ["action item 1"]
}`;
}

export async function analyzeMeeting(
  input: MeetingInput,
  knowledge: TaggerKnowledge,
): Promise<MeetingAnalysis & { tagger_error?: boolean }> {
  const gateway = createGateway({ apiKey: process.env.VERCEL_AI_GATEWAY_KEY! });

  try {
    const { text } = await generateText({
      model: gateway('anthropic/claude-haiku-4-5'),
      prompt: buildPrompt(input, knowledge),
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ...UNKNOWN, tagger_error: true };

    const parsed = MeetingAnalysisSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) return { ...UNKNOWN, tagger_error: true };

    const result = parsed.data;
    if (result.confidence === 'low') {
      return { ...result, billing_client: { name: 'unknown', slug: 'unknown' }, end_client: null, project: null };
    }
    return result;
  } catch {
    return { ...UNKNOWN, tagger_error: true };
  }
}
