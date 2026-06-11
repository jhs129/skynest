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

// Pull every email domain we can see — from the structured participant list AND
// from the meeting text itself. Read.ai docs often write attendees as
// "Jane, Bob (all @orlandohealth.com)", so the domain lives in prose, not in a
// parseable address. Domains are the strongest billing-client signal, so we
// surface them explicitly rather than hoping the model spots them inline.
function extractDomains(input: MeetingInput): string[] {
  const DOMAIN_RE = /@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const haystack = [
    ...input.participants.map((p) => p.email),
    input.summary,
    input.topics.join('\n'),
    input.actionItems.join('\n'),
    ...input.chapters.map((c) => `${c.title}\n${c.description}`),
  ].join('\n');
  const found = new Set<string>();
  for (const match of haystack.matchAll(DOMAIN_RE)) {
    const domain = match[1].toLowerCase().replace(/[).,;:]+$/, '');
    if (!domain.includes('read.ai')) found.add(domain);
  }
  return Array.from(found);
}

function buildPrompt(input: MeetingInput, knowledge: TaggerKnowledge): string {
  const participants = input.participants
    .map((p) => p.email || p.name || 'unknown')
    .join(', ');
  const domains = extractDomains(input);
  const domainLine = domains.length ? domains.join(', ') : '(none detected)';
  const topics = input.topics.map((t) => `- ${t}`).join('\n') || '(none)';
  const actionItems = input.actionItems.map((a) => `- ${a}`).join('\n') || '(none)';
  const chapters = input.chapters
    .map((c) => `### ${c.title || '(untitled)'}\n${c.description}`)
    .join('\n\n');

  return `You tag a meeting report by CLIENT, PROJECT, and TOPIC for a knowledge vault.

## How to pick the client
The participant EMAIL DOMAINS are the strongest signal for the billing client.
Match them against the registry's domain lookup FIRST, before weighing the meeting
content. A single attendee on a known client domain (e.g. someone @centurycommunities.com
or @orlandohealth.com) is enough to assign that client with high confidence — do NOT
return "unknown" when a domain clearly matches the registry. Only fall back to the
Client Identification Rules and meeting content when no attendee domain matches.
When the end client differs from who is billed (e.g. ALZ.org under Laughlin Constable,
Georgia Core under Radical Design, Aventiv under Goods & Services), report both.

## Client & Project Registry
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
Participant email domains (match these against the registry FIRST): ${domainLine}

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
  // No explicit apiKey: the gateway resolves AI_GATEWAY_API_KEY from the env,
  // falling back to the Vercel OIDC token when deployed. (Hardcoding an unset
  // var here silently broke auth and made every meeting tag as "unknown".)
  const gateway = createGateway();

  try {
    const { text } = await generateText({
      model: gateway('anthropic/claude-haiku-4-5'),
      // temperature 0 makes the tag for a given meeting reproducible run-to-run.
      // Without it, borderline meetings flip between a correct client and
      // "unknown" across backfills, which makes the QA report unreviewable.
      temperature: 0,
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
