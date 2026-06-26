# Meeting Tagging Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-engineer the Read.ai tagging pipeline to tag every meeting by **client** (billing + sub-client), **project** (Harvest code + name), and **topic** (canonical + free-form), wired to John's Harvest context; then re-tag every existing meeting and stand up a QA/feedback loop to refine the tagger over time.

**Architecture:** Three vault "knowledge" documents feed the tagger — (1) a client/project **registry** (John's existing Harvest context doc), (2) a canonical **topic vocabulary**, (3) a **tagging-examples / corrections** doc (few-shot, the durable training surface). The analyzer is refactored to a model-agnostic `MeetingInput`, with an extended structured output (billing client, end/sub-client, project `{code,name}`, canonical + free-form topics). `document.ts` emits namespaced tags (`#client_*`, `#subclient_*`, `#project_*`, `#topic_*`, free-form) plus structured metadata for retrieval. A backfill script reconstructs `MeetingInput` from existing meeting docs, runs the **real production analyzer**, and — after a dry-run QA checkpoint — rewrites tags/metadata across the corpus. The QA loop is: dry-run review → John's feedback → encode into the three knowledge docs → re-run.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Vercel AI Gateway (`anthropic/claude-haiku-4-5`), Vitest, `@promptowl/contextnest-engine` (Blob storage + git sync), `tsx` for scripts.

---

## Tagging Spec (the contract every task implements)

**Tag regex (engine-enforced):** `^#?[a-zA-Z][a-zA-Z0-9_-]*$` — **no slashes**. Dimensions are namespaced with an underscore prefix; the value keeps its kebab slug.

| Dimension | Tag form | Example | Always present? |
|---|---|---|---|
| Meeting marker | `#meetings` | `#meetings` | Yes |
| Billing client | `#client_<slug>` | `#client_laughlin-constable` | Yes (or `#client_unknown`) |
| End / sub-client | `#subclient_<slug>` | `#subclient_alz-org` | Only when end client ≠ billing client |
| Project | `#project_<code>` | `#project_oh26mt` (code lowercased) | When a project is identified |
| Canonical topic | `#topic_<name>` | `#topic_go-live` | 1–N |
| Free-form topic | `#<name>` | `#sitecore`, `#sprint-38` | 0–2 |
| Needs review | `#needs-review` | `#needs-review` | When confidence=low or tagger errored |

**Metadata (structured truth, drives retrieval + Harvest join):**
```yaml
metadata:
  document_type: meeting
  client: laughlin-constable          # billing client slug
  client_name: Laughlin Constable
  subclient: alz-org                  # omitted when no sub-client
  subclient_name: ALZ.org
  project_code: LCALZ                 # omitted when no project
  project: ALZ RFP
  topics: [go-live, seo]              # canonical + free-form, flat list
  meeting_date: 2026-06-08T14:00:00Z
  participants: [a@x.com, b@y.com]
  platform: teams
  report_url: https://app.read.ai/...
  readai_id: 01KT...
  request_id: req_...
  source: readai
  tagger_confidence: high
  # tagger_error: true               # only when the model call failed
```
Retrieval works three ways for every dimension: faceted (`resolve("#project_oh26mt + #meetings")`), exact (`metadata.project_code`), and full-text (readable names live in metadata **and** body).

**Knowledge doc paths (single source of truth, all human-editable):**
- Registry: `nodes/clients/harvest-client-project-context` (already in the vault)
- Topic vocabulary: `nodes/processes/meeting-topic-vocabulary` (new)
- Tagging examples/corrections: `nodes/processes/meeting-tagging-examples` (new)

---

## File Structure

**Create:**
- `src/lib/webhooks/readai/input.ts` — `MeetingInput` type + `fromReadAiPayload()` adapter
- `scripts/backfill-meeting-tags.ts` — enumerate → reconstruct → analyze → dry-run/apply
- `scripts/lib/parse-meeting-doc.ts` — parse an existing meeting doc body → `MeetingInput`
- `docs/superpowers/reviews/` — dry-run QA reports land here (gitignored output dir; `.gitkeep` tracked)

**Modify:**
- `src/lib/webhooks/readai/schema.ts` — replace `HaikuAnalysisSchema` with `MeetingAnalysisSchema`
- `src/lib/webhooks/readai/analyze.ts` — model-agnostic input, three-part knowledge, new prompt + output
- `src/lib/webhooks/readai/document.ts` — namespaced tags + structured metadata
- `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.ts` — load 3 knowledge docs, build `MeetingInput`
- `src/lib/webhooks/readai/analyze.test.ts` — rewrite for new signature/schema
- `src/lib/webhooks/readai/document.test.ts` — rewrite for new tags/metadata

**Vault docs (via skynest MCP, not files):**
- `nodes/processes/meeting-topic-vocabulary` (create)
- `nodes/processes/meeting-tagging-examples` (create)
- `nodes/processes/meeting-tagging` (create — process/QA-loop description)

---

## Phase 0 — Knowledge docs in the vault

### Task 0.1: Seed the canonical topic vocabulary

**Files:** vault doc `nodes/processes/meeting-topic-vocabulary` (skynest MCP)

- [ ] **Step 1: Create the vocabulary doc.** Use `mcp__skynest__create_document` with `path: "nodes/processes/meeting-topic-vocabulary"`, `type: "reference"`, `tags: ["#process","#meetings","#tagging","#topics"]`, `title: "Meeting Topic Vocabulary"`. Body: a markdown list of canonical topic slugs grouped by theme, seeded from the existing corpus. Each line is `- \`<slug>\` — <when to use it>`. Seed set:

```markdown
# Meeting Topic Vocabulary

Canonical topic slugs the tagger maps to first. Add new ones here as they recur.
Free-form tags are allowed for specifics (max 2) but prefer a canonical match.

## Delivery / Engineering
- `scrum` — standups, sprint planning, sprint reviews
- `go-live` — launch, go/no-go, cutover, launch-day (canonical for launch/website-launch)
- `migration` — content/platform/provider migration work
- `qa` — testing, bug triage, defect review
- `debugging` — live troubleshooting of a specific defect
- `seo` — search optimization, schema, metadata
- `development` — general build/coding discussion

## Strategy / Advisory
- `strategy` — strategic planning, roadmap
- `digital-strategy` — digital/marketing strategy specifically
- `content-strategy` — content planning and governance
- `sales-strategy` — pipeline, prospects, positioning
- `planning` — project/workshop planning, scheduling

## Governance / Audit
- `governance` — data/AI/platform governance
- `audit` — formal audit engagement work
- `stakeholder-interview` — audit/discovery interviews

## Commercial
- `partnership` — partner/vendor relationship meetings
- `proposal` — pitches, RFP responses, proposals
- `budget` — budgeting and financial planning
- `onboarding` — team/client onboarding and access

## Product / Demo
- `product-demo` — product or tool demonstrations
- `webinar` — webinar planning/delivery
```

- [ ] **Step 2: Publish.** `mcp__skynest__publish_document({ path: "nodes/processes/meeting-topic-vocabulary", author: "claude@claude.ai", note: "Seed canonical topic vocabulary" })`.

### Task 0.2: Create the tagging-examples / corrections doc

**Files:** vault doc `nodes/processes/meeting-tagging-examples` (skynest MCP)

- [ ] **Step 1: Create with a minimal seed.** `create_document` `path: "nodes/processes/meeting-tagging-examples"`, `type: "reference"`, `tags: ["#process","#meetings","#tagging","#examples"]`, `title: "Meeting Tagging Examples & Corrections"`. Body:

```markdown
# Meeting Tagging Examples & Corrections

Few-shot guidance injected into the tagger prompt. Each example is a correction
captured during QA — add a new block whenever the tagger gets one wrong.

## Rules
- "OH Web Scrum" / "OH.com" → billing client Orlando Health (OH26MT). Topic: scrum (or go-live for launch meetings).
- "ALZ.org" pitch/preso → billing client Laughlin Constable, sub-client ALZ.org, project LCALZ. Topic: proposal.
- "DP Seeds" → personal/owned business; billing client NE Seed (NESO) unless context says otherwise.
- Builder.io / Vercel are PARTNERS on Orlando Health (OH26MT), not clients — tag client Orlando Health + free-form #builder-io / #vercel.

## Examples
(none yet — QA will add corrected examples here)
```

- [ ] **Step 2: Publish.** `publish_document` with note "Seed tagging examples/corrections".

### Task 0.3: Confirm registry doc is consumable

**Files:** vault doc `nodes/clients/harvest-client-project-context` (read-only check)

- [ ] **Step 1: Read it.** `mcp__skynest__read_document({ uri: "nodes/clients/harvest-client-project-context" })`. Confirm it contains the "Email Domain → Client" table and the "Harvest Project Code Index". (It does, per review.) No edit needed — Phase 3 points the analyzer at this path.

---

## Phase 1 — Schema + analyzer (TDD)

### Task 1.1: New analysis schema + MeetingInput

**Files:**
- Modify: `src/lib/webhooks/readai/schema.ts`
- Create: `src/lib/webhooks/readai/input.ts`
- Test: `src/lib/webhooks/readai/schema.test.ts` (existing — extend)

- [ ] **Step 1: Write failing test for the new schema** — append to `src/lib/webhooks/readai/schema.test.ts`:

```typescript
import { MeetingAnalysisSchema } from './schema';

describe('MeetingAnalysisSchema', () => {
  it('accepts a full analysis with sub-client and project', () => {
    const parsed = MeetingAnalysisSchema.safeParse({
      billing_client: { name: 'Laughlin Constable', slug: 'laughlin-constable' },
      end_client: { name: 'ALZ.org', slug: 'alz-org' },
      project: { code: 'LCALZ', name: 'ALZ RFP' },
      confidence: 'high',
      topics_canonical: ['proposal'],
      topics_freeform: ['alz-org'],
      summary: 'Pitch prep.',
      action_items: ['Finalize deck'],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts null end_client and null project', () => {
    const parsed = MeetingAnalysisSchema.safeParse({
      billing_client: { name: 'Orlando Health', slug: 'orlando-health' },
      end_client: null,
      project: null,
      confidence: 'medium',
      topics_canonical: ['scrum'],
      topics_freeform: [],
      summary: 'Standup.',
      action_items: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects more than two free-form topics', () => {
    const parsed = MeetingAnalysisSchema.safeParse({
      billing_client: { name: 'X', slug: 'x' },
      end_client: null, project: null, confidence: 'low',
      topics_canonical: [], topics_freeform: ['a', 'b', 'c'],
      summary: '', action_items: [],
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify it fails.** `pnpm vitest run src/lib/webhooks/readai/schema.test.ts` — Expected: FAIL, `MeetingAnalysisSchema` is not exported.

- [ ] **Step 3: Implement schema.** In `src/lib/webhooks/readai/schema.ts`, **replace** the `HaikuAnalysisSchema`/`HaikuAnalysis` block (lines 56–65) with:

```typescript
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
```

- [ ] **Step 4: Create `MeetingInput`.** Create `src/lib/webhooks/readai/input.ts`:

```typescript
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
```

- [ ] **Step 5: Run, verify pass.** `pnpm vitest run src/lib/webhooks/readai/schema.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(readai): add MeetingAnalysis schema and MeetingInput adapter"`

### Task 1.2: Rewrite the analyzer

**Files:**
- Modify: `src/lib/webhooks/readai/analyze.ts`
- Test: `src/lib/webhooks/readai/analyze.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the test** — replace `src/lib/webhooks/readai/analyze.test.ts` entirely:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MeetingInput } from './input';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@ai-sdk/gateway', () => ({ createGateway: vi.fn(() => vi.fn()) }));

import { generateText } from 'ai';
import { analyzeMeeting } from './analyze';

const mockGenerateText = vi.mocked(generateText);

const INPUT: MeetingInput = {
  title: 'OH Web Scrum',
  date: '2026-06-08T14:00:00Z',
  platform: 'teams',
  participants: [{ name: 'John Schneider', email: 'john.schneider@orlandohealth.com' }],
  summary: 'Sprint 38 planning.',
  topics: ['sprint planning'],
  actionItems: ['Add Alex to Vercel'],
  chapters: [],
};

const KNOWLEDGE = {
  registry: '| `orlandohealth.com` | Orlando Health | Orlando Health | 2026 Martech Staffing (OH26MT) |',
  topicVocab: '- `scrum` — standups',
  examples: 'OH Web Scrum -> Orlando Health, OH26MT, topic scrum',
};

const VALID = JSON.stringify({
  billing_client: { name: 'Orlando Health', slug: 'orlando-health' },
  end_client: null,
  project: { code: 'OH26MT', name: '2026 Martech Staffing' },
  confidence: 'high',
  topics_canonical: ['scrum'],
  topics_freeform: [],
  summary: 'Sprint 38 planning.',
  action_items: ['Add Alex to Vercel'],
});

function resolve(text: string) {
  return { text } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never;
}

describe('analyzeMeeting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_AI_GATEWAY_KEY = 'test-key';
  });

  it('parses a valid response with project and client', async () => {
    mockGenerateText.mockResolvedValue(resolve(VALID));
    const r = await analyzeMeeting(INPUT, KNOWLEDGE);
    expect(r.billing_client.slug).toBe('orlando-health');
    expect(r.project?.code).toBe('OH26MT');
    expect(r.confidence).toBe('high');
    expect(r.tagger_error).toBeUndefined();
  });

  it('flags tagger_error and unknown client on unparseable output', async () => {
    mockGenerateText.mockResolvedValue(resolve('not json'));
    const r = await analyzeMeeting(INPUT, KNOWLEDGE);
    expect(r.billing_client.slug).toBe('unknown');
    expect(r.tagger_error).toBe(true);
  });

  it('forces unknown client when confidence is low', async () => {
    const low = JSON.stringify({
      billing_client: { name: 'Maybe', slug: 'maybe' },
      end_client: null, project: null, confidence: 'low',
      topics_canonical: [], topics_freeform: [], summary: '', action_items: [],
    });
    mockGenerateText.mockResolvedValue(resolve(low));
    const r = await analyzeMeeting(INPUT, KNOWLEDGE);
    expect(r.billing_client.slug).toBe('unknown');
    expect(r.project).toBeNull();
  });

  it('injects all three knowledge docs and input into the prompt', async () => {
    mockGenerateText.mockResolvedValue(resolve(VALID));
    await analyzeMeeting(INPUT, KNOWLEDGE);
    const prompt = mockGenerateText.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('orlandohealth.com');
    expect(prompt).toContain('scrum');
    expect(prompt).toContain('OH Web Scrum');
    expect(prompt).toContain('OH26MT');
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm vitest run src/lib/webhooks/readai/analyze.test.ts` — Expected: FAIL (signature/exports changed).

- [ ] **Step 3: Rewrite `analyze.ts`** entirely:

```typescript
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

function buildPrompt(input: MeetingInput, k: TaggerKnowledge): string {
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
${k.registry || '(no registry available)'}

## Canonical Topic Vocabulary
Map topics to these slugs FIRST. Add at most two free-form topics for specifics.
${k.topicVocab || '(no vocabulary available)'}

## Tagging Examples & Corrections
${k.examples || '(none)'}

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
```

- [ ] **Step 4: Run, verify pass.** `pnpm vitest run src/lib/webhooks/readai/analyze.test.ts` — Expected: PASS (all 4).

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(readai): client+project+topic analyzer with 3-part knowledge"`

---

## Phase 2 — Document builder (TDD)

### Task 2.1: Tag + metadata builder

**Files:**
- Modify: `src/lib/webhooks/readai/document.ts`
- Test: `src/lib/webhooks/readai/document.test.ts` (rewrite)

- [ ] **Step 1: Write failing tests** — replace `src/lib/webhooks/readai/document.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { buildMeetingDocument } from './document';
import type { MeetingInput } from './input';
import type { MeetingAnalysis } from './schema';

const INPUT: MeetingInput = {
  title: 'ALZ.org Pitch',
  date: '2026-06-01T14:00:00Z',
  platform: 'zoom',
  participants: [{ name: 'Jane', email: 'jane@laughlin-constable.com' }],
  summary: 'Pitch prep.',
  topics: ['pitch'],
  actionItems: ['Finalize deck'],
  chapters: [],
};

const ANALYSIS: MeetingAnalysis & { tagger_error?: boolean } = {
  billing_client: { name: 'Laughlin Constable', slug: 'laughlin-constable' },
  end_client: { name: 'ALZ.org', slug: 'alz-org' },
  project: { code: 'LCALZ', name: 'ALZ RFP' },
  confidence: 'high',
  topics_canonical: ['proposal'],
  topics_freeform: ['alz-org'],
  summary: 'Pitch prep.',
  action_items: ['Finalize deck'],
};

describe('buildMeetingDocument', () => {
  it('emits namespaced client/subclient/project/topic tags', () => {
    const { frontmatter } = buildMeetingDocument(INPUT, ANALYSIS, 'req_1', 'sess_1', 'https://r');
    expect(frontmatter.tags).toEqual(expect.arrayContaining([
      '#meetings',
      '#client_laughlin-constable',
      '#subclient_alz-org',
      '#project_lcalz',
      '#topic_proposal',
      '#alz-org',
    ]));
    expect(frontmatter.tags).not.toContain('#needs-review');
  });

  it('writes structured metadata for code + name retrieval', () => {
    const { frontmatter } = buildMeetingDocument(INPUT, ANALYSIS, 'req_1', 'sess_1', 'https://r');
    const m = frontmatter.metadata as Record<string, unknown>;
    expect(m.client).toBe('laughlin-constable');
    expect(m.client_name).toBe('Laughlin Constable');
    expect(m.subclient).toBe('alz-org');
    expect(m.project_code).toBe('LCALZ');
    expect(m.project).toBe('ALZ RFP');
    expect(m.topics).toEqual(['proposal', 'alz-org']);
  });

  it('omits subclient/project keys when absent', () => {
    const a: MeetingAnalysis = {
      ...ANALYSIS, end_client: null, project: null, topics_freeform: [],
    };
    const { frontmatter } = buildMeetingDocument(INPUT, a, 'r', 's', 'u');
    const m = frontmatter.metadata as Record<string, unknown>;
    expect(m.subclient).toBeUndefined();
    expect(m.project_code).toBeUndefined();
    expect(frontmatter.tags).not.toContain('#subclient_alz-org');
  });

  it('adds #needs-review on low confidence', () => {
    const a = { ...ANALYSIS, confidence: 'low' as const };
    const { frontmatter } = buildMeetingDocument(INPUT, a, 'r', 's', 'u');
    expect(frontmatter.tags).toContain('#needs-review');
  });

  it('adds #needs-review on tagger_error', () => {
    const a = { ...ANALYSIS, tagger_error: true };
    const { frontmatter } = buildMeetingDocument(INPUT, a, 'r', 's', 'u');
    expect(frontmatter.tags).toContain('#needs-review');
  });

  it('sanitizes tag segments to the engine regex', () => {
    const a: MeetingAnalysis = { ...ANALYSIS, topics_freeform: ['Sprint 38!'] };
    const { frontmatter } = buildMeetingDocument(INPUT, a, 'r', 's', 'u');
    for (const t of frontmatter.tags!) {
      expect(t).toMatch(/^#[a-zA-Z][a-zA-Z0-9_-]*$/);
    }
    expect(frontmatter.tags).toContain('#sprint-38');
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm vitest run src/lib/webhooks/readai/document.test.ts` — Expected: FAIL (signature changed).

- [ ] **Step 3: Rewrite `document.ts`** entirely:

```typescript
import type { Frontmatter } from '@promptowl/contextnest-engine';
import type { MeetingInput } from './input';
import type { MeetingAnalysis } from './schema';

export interface MeetingDocumentParts {
  id: string;
  frontmatter: Frontmatter;
  body: string;
}

/** Lowercase, strip to the engine tag regex, ensure a leading letter. */
function sanitizeSegment(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(s) ? s : `x-${s}`;
}

function buildDateSlug(input: MeetingInput, analysis: MeetingAnalysis): { date: string; slug: string } {
  const date = input.date && input.date !== 'unknown' ? input.date.slice(0, 10) : 'unknown-date';
  const titleSlug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const clientPart = analysis.billing_client.slug !== 'unknown' ? `${analysis.billing_client.slug}-` : '';
  const slug = `${clientPart}${titleSlug}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return { date, slug };
}

function buildTags(analysis: MeetingAnalysis & { tagger_error?: boolean }): string[] {
  const tags = new Set<string>(['#meetings']);
  tags.add(`#client_${sanitizeSegment(analysis.billing_client.slug)}`);
  if (analysis.end_client) tags.add(`#subclient_${sanitizeSegment(analysis.end_client.slug)}`);
  if (analysis.project) tags.add(`#project_${sanitizeSegment(analysis.project.code)}`);
  for (const t of analysis.topics_canonical) tags.add(`#topic_${sanitizeSegment(t)}`);
  for (const t of analysis.topics_freeform) tags.add(`#${sanitizeSegment(t)}`);
  if (analysis.confidence === 'low' || analysis.tagger_error) tags.add('#needs-review');
  return [...tags];
}

export function buildMeetingDocument(
  input: MeetingInput,
  analysis: MeetingAnalysis & { tagger_error?: boolean },
  requestId: string,
  readaiId: string,
  reportUrl: string | undefined,
): MeetingDocumentParts {
  const { date, slug } = buildDateSlug(input, analysis);
  const id = `nodes/meetings/${date}-${slug}`;

  const participants = input.participants
    .map((p) => p.email || p.name)
    .filter((v): v is string => !!v);

  const metadataRaw: Record<string, unknown> = {
    document_type: 'meeting',
    client: analysis.billing_client.slug,
    client_name: analysis.billing_client.name,
    subclient: analysis.end_client?.slug,
    subclient_name: analysis.end_client?.name,
    project_code: analysis.project?.code,
    project: analysis.project?.name,
    topics: [...analysis.topics_canonical, ...analysis.topics_freeform],
    meeting_date: input.date !== 'unknown' ? input.date : undefined,
    participants,
    platform: input.platform !== 'unknown' ? input.platform : undefined,
    report_url: reportUrl,
    readai_id: readaiId,
    request_id: requestId,
    source: 'readai',
    tagger_confidence: analysis.confidence,
    ...(analysis.tagger_error ? { tagger_error: true } : {}),
  };
  const metadata = Object.fromEntries(Object.entries(metadataRaw).filter(([, v]) => v !== undefined));

  const titleClient = analysis.billing_client.name !== 'unknown' ? `${analysis.billing_client.name} — ` : '';
  const frontmatter: Frontmatter = {
    title: `${titleClient}${input.title} — ${date}`,
    type: 'document',
    status: 'published',
    tags: buildTags(analysis),
    metadata,
  };

  return { id, frontmatter, body: buildBody(input, analysis) };
}

function buildBody(input: MeetingInput, analysis: MeetingAnalysis): string {
  const lines: string[] = [];
  lines.push('## Summary', '', analysis.summary || input.summary || '', '');

  // Readable client/project names in the body so full-text search finds them.
  const ctx: string[] = [];
  if (analysis.billing_client.name !== 'unknown') ctx.push(`**Client:** ${analysis.billing_client.name}`);
  if (analysis.end_client) ctx.push(`**End client:** ${analysis.end_client.name}`);
  if (analysis.project) ctx.push(`**Project:** ${analysis.project.name} (${analysis.project.code})`);
  if (ctx.length) lines.push('## Context', '', ...ctx, '');

  if (analysis.action_items.length) {
    lines.push('## Action Items', '');
    analysis.action_items.forEach((i) => lines.push(`- ${i}`));
    lines.push('');
  }
  if (input.topics.length) {
    lines.push('## Topics', '');
    input.topics.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  if (input.participants.length) {
    lines.push('## Participants', '');
    input.participants.forEach((p) => {
      const label = p.name && p.email ? `${p.name} (${p.email})` : p.name || p.email || 'unknown';
      lines.push(`- ${label}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm vitest run src/lib/webhooks/readai/document.test.ts` — Expected: PASS (all tests).

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(readai): namespaced tags + structured metadata in meeting doc"`

---

## Phase 3 — Wire the route to the three knowledge docs

### Task 3.1: Load registry + vocab + examples; build MeetingInput

**Files:** Modify `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.ts`

- [ ] **Step 1: Update imports.** Replace the analyze/document import lines (11–12) with:

```typescript
import { analyzeMeeting } from '@/lib/webhooks/readai/analyze';
import { buildMeetingDocument } from '@/lib/webhooks/readai/document';
import { fromReadAiPayload } from '@/lib/webhooks/readai/input';
```

- [ ] **Step 2: Add a knowledge loader helper** above the `POST` export:

```typescript
const KNOWLEDGE_PATHS = {
  registry: 'nodes/clients/harvest-client-project-context',
  topicVocab: 'nodes/processes/meeting-topic-vocabulary',
  examples: 'nodes/processes/meeting-tagging-examples',
} as const;

async function loadKnowledge(storage: {
  readDocument: (id: string) => Promise<{ rawContent: string } | null>;
}): Promise<{ registry: string; topicVocab: string; examples: string }> {
  const read = async (id: string) => {
    try {
      const doc = await storage.readDocument(id);
      return doc?.rawContent ?? '';
    } catch {
      return '';
    }
  };
  const [registry, topicVocab, examples] = await Promise.all([
    read(KNOWLEDGE_PATHS.registry),
    read(KNOWLEDGE_PATHS.topicVocab),
    read(KNOWLEDGE_PATHS.examples),
  ]);
  return { registry, topicVocab, examples };
}
```

- [ ] **Step 3: Replace the registry read + analysis block** (current lines 81–105). Replace from `// Read client registry` through the `console.log(...analyze ok...)` line with:

```typescript
  // Load tagging knowledge (all non-fatal if missing)
  console.log(`[skynest] step: load knowledge`);
  const knowledge = await loadKnowledge(storage);

  // Tagger analysis (failure is non-fatal — document is always written)
  console.log(`[skynest] step: analyze meeting`);
  const input = fromReadAiPayload(payload);
  let analysis;
  try {
    analysis = await analyzeMeeting(input, knowledge);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[skynest] analyzeMeeting threw (non-fatal): ${msg}`);
    analysis = {
      billing_client: { name: 'unknown', slug: 'unknown' },
      end_client: null, project: null, confidence: 'low' as const,
      topics_canonical: [], topics_freeform: [], summary: '', action_items: [],
      tagger_error: true,
    };
  }
  console.log(`[skynest] step: analyze ok tagger_error=${(analysis as { tagger_error?: boolean }).tagger_error ?? false}`);
```

- [ ] **Step 4: Update the buildMeetingDocument call** (current line 105):

```typescript
  const { id, frontmatter, body } = buildMeetingDocument(
    input,
    analysis,
    payload.request_id,
    payload.session_id,
    payload.report_url,
  );
```

- [ ] **Step 5: Build the app.** `pnpm build` — Expected: compiles with no type errors. Fix any leftover references to the old `HaikuAnalysis`/`registryText`.

- [ ] **Step 6: Run the route test + full unit suite.** `pnpm vitest run src/lib/webhooks src/app/api` — Expected: PASS. Update `route.test.ts` mocks if they referenced the old analyze signature (change mocked return to the new `MeetingAnalysis` shape; assert on new tags/metadata).

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(readai): wire webhook to registry+vocab+examples knowledge docs"`

---

## Phase 4 — Backfill tooling

### Task 4.1: Parse an existing meeting doc into MeetingInput

**Files:**
- Create: `scripts/lib/parse-meeting-doc.ts`
- Test: `scripts/lib/parse-meeting-doc.test.ts`

- [ ] **Step 1: Write failing test.** Create `scripts/lib/parse-meeting-doc.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMeetingDoc } from './parse-meeting-doc';

const BODY = `
## Meeting Details
- **Date:** 2026-06-08
- **Participants:** Lance Amolo (p-lamolo@orlandohealth.com), John Schneider (john.schneider@orlandohealth.com)
- **Platform:** teams
- **Read.ai ID:** 01KTKR670BP022RK2Y9B76CQPF

## Summary
Sprint 38 planning and deploy unblock.
`;

describe('parseMeetingDoc', () => {
  it('extracts participants emails, summary, date, readai id', () => {
    const input = parseMeetingDoc('Orlando Health — OH Web Scrum — 2026-06-08', BODY);
    expect(input.participants.map((p) => p.email)).toEqual(
      expect.arrayContaining(['p-lamolo@orlandohealth.com', 'john.schneider@orlandohealth.com']),
    );
    expect(input.summary).toContain('Sprint 38');
    expect(input.title).toBe('OH Web Scrum');
    expect(input.date.slice(0, 10)).toBe('2026-06-08');
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm vitest run scripts/lib/parse-meeting-doc.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Create `scripts/lib/parse-meeting-doc.ts`:

```typescript
import type { MeetingInput } from '../../src/lib/webhooks/readai/input';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

/** Strip a "Client — Title — YYYY-MM-DD" frontmatter title down to the meeting title. */
function cleanTitle(title: string): string {
  const parts = title.split('—').map((s) => s.trim());
  if (parts.length >= 3) return parts.slice(1, -1).join(' — ');
  if (parts.length === 2) return parts[1];
  return title.trim();
}

export function parseMeetingDoc(title: string, body: string): MeetingInput {
  const emails = Array.from(new Set(body.match(EMAIL_RE) ?? []))
    .filter((e) => !e.includes('read.ai'));
  const dateMatch = body.match(DATE_RE);

  // Summary = text under a "## Summary" heading, else the whole body.
  const summaryMatch = body.match(/##\s*Summary\s*\n([\s\S]*?)(\n##\s|\n#\s|$)/i);
  const summary = (summaryMatch ? summaryMatch[1] : body).trim();

  return {
    title: cleanTitle(title),
    date: dateMatch ? `${dateMatch[1]}T00:00:00Z` : 'unknown',
    platform: 'unknown',
    participants: emails.map((email) => ({ name: '', email })),
    // Pass the whole body as topical context so the tagger has full signal.
    summary: summary || body.trim(),
    topics: [],
    actionItems: [],
    chapters: [],
  };
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm vitest run scripts/lib/parse-meeting-doc.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(backfill): parse existing meeting docs into MeetingInput"`

### Task 4.2: Backfill script (dry-run + apply)

**Files:** Create `scripts/backfill-meeting-tags.ts`

- [ ] **Step 1: Implement the script.** Create `scripts/backfill-meeting-tags.ts`:

```typescript
/**
 * Re-tag existing meeting docs with the production analyzer.
 *
 *   pnpm tsx scripts/backfill-meeting-tags.ts --dry-run            # all meetings -> review report
 *   pnpm tsx scripts/backfill-meeting-tags.ts --dry-run --limit 8  # pilot batch
 *   pnpm tsx scripts/backfill-meeting-tags.ts --apply --only nodes/meetings/2026-06-08-oh-web-scrum
 *   pnpm tsx scripts/backfill-meeting-tags.ts --apply             # rewrite all
 *
 * Requires env (loaded from .env.local): CONTEXTNEST_STORAGE, CONTEXTNEST_BLOB_PREFIX,
 * BLOB_READ_WRITE_TOKEN, CONTEXTNEST_DEFAULT_VAULT_ID, BOT_GITHUB_TOKEN, VAULT_REPO,
 * VAULT_BRANCH, VAULT_SYNC_PROVIDER, and AI Gateway auth (VERCEL_AI_GATEWAY_KEY or VERCEL_OIDC_TOKEN).
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { publishDocument, serializeDocument } from '@promptowl/contextnest-engine';
import { createEngine } from '../src/lib/vault/index';
import { analyzeMeeting } from '../src/lib/webhooks/readai/analyze';
import { buildMeetingDocument } from '../src/lib/webhooks/readai/document';
import { parseMeetingDoc } from './lib/parse-meeting-doc';

loadEnv({ path: '.env.local' });

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run') || !args.includes('--apply');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

async function main() {
  const vaultId = process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default';
  const botToken = process.env.BOT_GITHUB_TOKEN ?? '';
  const { storage, sync } = createEngine(botToken, vaultId);

  const read = async (id: string) => (await storage.readDocument(id))?.rawContent ?? '';
  const knowledge = {
    registry: await read('nodes/clients/harvest-client-project-context'),
    topicVocab: await read('nodes/processes/meeting-topic-vocabulary'),
    examples: await read('nodes/processes/meeting-tagging-examples'),
  };

  const all = await storage.discoverDocuments();
  let meetings = all.filter(
    (d) => d.id.startsWith('nodes/meetings/') && !d.id.endsWith('/overview'),
  );
  if (ONLY) meetings = meetings.filter((d) => d.id === ONLY);
  meetings = meetings.slice(0, LIMIT);

  console.log(`[backfill] ${meetings.length} meetings | mode=${DRY ? 'DRY-RUN' : 'APPLY'}`);

  const report: string[] = [`# Re-tag review — ${meetings.length} meetings\n`];

  for (const doc of meetings) {
    const title = String(doc.frontmatter.title ?? doc.id);
    const input = parseMeetingDoc(title, doc.body);
    const analysis = await analyzeMeeting(input, knowledge);
    const built = buildMeetingDocument(
      input,
      analysis,
      String(doc.frontmatter?.metadata?.['request_id'] ?? `backfill-${doc.id}`),
      String(doc.frontmatter?.metadata?.['readai_id'] ?? ''),
      doc.frontmatter?.metadata?.['report_url'] as string | undefined,
    );

    const before = (doc.frontmatter.tags ?? []).join(' ');
    const after = (built.frontmatter.tags ?? []).join(' ');
    report.push(
      `## ${doc.id}`,
      `- **was:** ${before || '(none)'}`,
      `- **now:** ${after}`,
      `- **client:** ${analysis.billing_client.name}` +
        (analysis.end_client ? ` / end: ${analysis.end_client.name}` : '') +
        (analysis.project ? ` | project: ${analysis.project.name} (${analysis.project.code})` : '') +
        ` | conf: ${analysis.confidence}`,
      '',
    );
    console.log(`  ${analysis.confidence.padEnd(6)} ${doc.id} -> ${after}`);

    if (!DRY) {
      // Preserve the original body; only re-tag. Rewrite frontmatter at the SAME id.
      const node = {
        id: doc.id, filePath: '', frontmatter: built.frontmatter,
        body: doc.body, rawContent: '',
      };
      const content = serializeDocument(node);
      await storage.writeDocument(doc.id, content);
      await publishDocument(storage, doc.id, { editedBy: 'skynest-bot', note: 'Re-tag: client/project/topic backfill' });
      await sync.commitFile({
        path: `${doc.id}.md`, content: Buffer.from(content, 'utf-8'),
        message: `retag: ${doc.id}`, userToken: botToken,
      });
    }
  }

  if (!DRY) await storage.regenerateIndex();

  if (DRY) {
    mkdirSync('docs/superpowers/reviews', { recursive: true });
    const out = `docs/superpowers/reviews/retag-${new Date().toISOString().slice(0, 10)}.md`;
    writeFileSync(out, report.join('\n'));
    console.log(`[backfill] dry-run report -> ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

> Note: `new Date()` here runs in a one-shot script (not a workflow), so it is fine.

- [ ] **Step 2: Ensure `tsx` + `dotenv` are available.** `pnpm add -D tsx dotenv` (skip if already present — check `package.json` first).

- [ ] **Step 3: Smoke-test parse path without hitting the model.** Run a single dry-run on one doc: `pnpm tsx scripts/backfill-meeting-tags.ts --dry-run --only nodes/meetings/2026-06-08-oh-web-scrum`. Expected: prints one line and writes a report. If AI Gateway auth fails locally, run `vercel env pull .env.local` to refresh `VERCEL_OIDC_TOKEN`, then retry.

- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(backfill): re-tag script with dry-run + apply"`

---

## Phase 5 — QA pilot + feedback loop (HUMAN CHECKPOINT)

### Task 5.1: Pilot dry-run across a diverse sample

- [ ] **Step 1: Run a dry-run on the full corpus.** `pnpm tsx scripts/backfill-meeting-tags.ts --dry-run`. This calls the real Haiku tagger on every meeting and writes `docs/superpowers/reviews/retag-<date>.md`.

- [ ] **Step 2: Present the report to John.** Surface the report (especially `#needs-review` / low-confidence rows and any `client: unknown`). **STOP for review** — this is the QA checkpoint John asked for.

### Task 5.2: Encode John's feedback into the knowledge docs

- [ ] **Step 1: For each correction, decide where it belongs:**
  - Wrong/missing client↔domain or project↔code → fix `nodes/clients/harvest-client-project-context` (registry).
  - New or renamed topic, synonym collapse → fix `nodes/processes/meeting-topic-vocabulary`.
  - A subtle judgment the model keeps missing → add a worked example to `nodes/processes/meeting-tagging-examples` (title → correct billing client / sub-client / project / topics, with a one-line reason).
- [ ] **Step 2: Update + publish** the relevant doc(s) via skynest MCP (`update_document` then `publish_document`).
- [ ] **Step 3: Re-run the pilot dry-run** and confirm the corrected meetings now tag correctly. Repeat 5.1→5.2 until John signs off on the sample.

### Task 5.3: Document the loop

- [ ] **Step 1: Create `nodes/processes/meeting-tagging`** (skynest MCP, `type: "document"`, tags `["#process","#meetings","#tagging","#automation"]`) describing: the tag spec, the three knowledge docs, how the webhook uses them, and the QA re-tag loop (dry-run → review → encode feedback → re-run). Publish it.

---

## Phase 6 — Full backfill + verify

### Task 6.1: Apply the re-tag to the whole corpus

- [ ] **Step 1: Apply.** After sign-off: `pnpm tsx scripts/backfill-meeting-tags.ts --apply`. Each doc is rewritten (body preserved), published, and git-synced.
- [ ] **Step 2: Verify integrity.** `mcp__skynest__verify_integrity` — Expected: all hash chains valid.
- [ ] **Step 3: Spot-check retrieval.** Confirm faceted retrieval works:
  - `mcp__skynest__resolve({ selector: "#project_oh26mt + #meetings", hops: 1 })` → returns Orlando Health Martech meetings.
  - `mcp__skynest__resolve({ selector: "#needs-review", hops: 1 })` → returns only genuinely ambiguous meetings.
  - `mcp__skynest__search({ query: "ALZ.org", hops: 1 })` → returns Laughlin/ALZ meetings (full-text via body + metadata).
- [ ] **Step 4: Final commit.** `git add -A && git commit -m "chore(meetings): backfill complete — client/project/topic tags across corpus"` (vault writes already synced via bot; this commits any local report/doc changes).

---

## Self-Review

**Spec coverage:**
- Client (billing + sub-client) → Task 1.1 schema, 1.2 prompt, 2.1 tags/metadata ✓
- Project (code + name, retrieval 3 ways) → 1.1 schema, 2.1 (`#project_*` tag + `project_code`/`project` metadata + body line) ✓
- Topic (canonical + free-form) → 0.1 vocab, 1.2 prompt, 2.1 `#topic_*` + free-form ✓
- Wire context into tagger → 0.3 + 3.1 (registry now actually loaded; was the empty-`clients/registry` bug) ✓
- Re-tag all meetings → Phase 4 + 6 ✓
- QA + feedback/training loop → Phase 5 (dry-run report, encode into 3 knowledge docs, re-run) ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; tests have real assertions. ✓

**Type consistency:** `MeetingAnalysis` (billing_client, end_client, project, confidence, topics_canonical, topics_freeform, summary, action_items) used identically in schema/analyze/document/backfill. `MeetingInput` shape identical in input.ts, analyze.ts, document.ts, parse-meeting-doc.ts. `analyzeMeeting(input, knowledge)` and `buildMeetingDocument(input, analysis, requestId, readaiId, reportUrl)` signatures consistent across route + backfill. ✓

**Known risk:** Backfill parses prose bodies (not original payloads); participant emails — the strongest client signal — are reliably regex-extractable, and the whole body is passed as topical context. Low-confidence results get `#needs-review` and surface in the QA report rather than silently mistagging. Optional future fidelity: re-fetch original payloads via the read.ai MCP using `readai_id`.
