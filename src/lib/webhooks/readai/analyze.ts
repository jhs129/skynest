import { createGateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import { HaikuAnalysisSchema, type HaikuAnalysis, type ReadAiPayload } from './schema';

const DEFAULT_ANALYSIS: HaikuAnalysis = {
  client: 'Unknown',
  client_slug: 'unknown',
  confidence: 'low',
  tags: [],
  summary: '',
  action_items: [],
};

function buildPrompt(payload: ReadAiPayload, registryText: string): string {
  const participants = payload.participants
    .map((p) => p.email || p.name || 'unknown')
    .join(', ');
  const topics = payload.topics.map((t) => `- ${t}`).join('\n') || '(none)';
  const actionItems = payload.action_items.map((a) => `- ${a}`).join('\n') || '(none)';
  const chapters = payload.chapter_summaries
    .map((c) => `### ${c.title || '(untitled)'}\n${c.summary || ''}`)
    .join('\n\n');

  return `You are analyzing a meeting report to identify the client and summarize key information.

## Client Registry
${registryText || '(No client registry available)'}

## Meeting Report
Title: ${payload.title || '(untitled)'}
Date: ${payload.meeting_date || 'unknown'}
Platform: ${payload.platform || 'unknown'}
Participants: ${participants || 'none'}

Summary:
${payload.summary || '(none)'}

Topics:
${topics}

Action Items:
${actionItems}

Chapter Summaries:
${chapters || '(none)'}

Based on the client registry, identify which client this meeting is for and extract key information.
Return ONLY a JSON object with exactly this structure (no explanation, no markdown, just the JSON):
{
  "client": "Client Name from registry, or 'Unknown' if not identified",
  "client_slug": "kebab-case-slug, or 'unknown'",
  "confidence": "high" | "medium" | "low",
  "tags": ["tag1", "tag2"],
  "summary": "2-3 sentence summary of the meeting",
  "action_items": ["action item 1"]
}`;
}

export async function analyzeMeeting(
  payload: ReadAiPayload,
  registryText: string,
): Promise<HaikuAnalysis & { haiku_error?: boolean }> {
  const gateway = createGateway({ apiKey: process.env.VERCEL_AI_GATEWAY_KEY! });

  try {
    const { text } = await generateText({
      model: gateway('anthropic/claude-haiku-4-5'),
      prompt: buildPrompt(payload, registryText),
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ...DEFAULT_ANALYSIS, haiku_error: true };

    const parsed = HaikuAnalysisSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) return { ...DEFAULT_ANALYSIS, haiku_error: true };

    const result = parsed.data;
    if (result.confidence === 'low') {
      return { ...result, client: 'Unknown', client_slug: 'unknown' };
    }

    return result;
  } catch {
    return { ...DEFAULT_ANALYSIS, haiku_error: true };
  }
}
