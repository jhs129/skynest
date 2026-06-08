# Read.ai Webhook Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, stateless webhook endpoint that receives Read.ai meeting reports, matches them to a client via Haiku, and writes a structured vault document.

**Architecture:** `POST /api/webhooks/[apikey]/[vaultId]/readai` — two-layer security (path key + HMAC-SHA256), synchronous processing (verify → dedup → registry read → Haiku analysis → vault write), returns 500 on write failure to trigger Read.ai retries.

**Tech Stack:** Next.js 15 App Router, Vercel AI Gateway (`@ai-sdk/gateway` + `ai`), Zod, Node.js `crypto`, `@promptowl/contextnest-engine` (`publishDocument`, `serializeDocument`, `NestStorage`), Vitest.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/webhooks/readai/schema.ts` | Zod schemas: Read.ai payload, Haiku analysis response |
| `src/lib/webhooks/readai/verify.ts` | HMAC-SHA256 signature verification |
| `src/lib/webhooks/readai/dedup.ts` | Request ID deduplication via `discoverDocuments()` |
| `src/lib/webhooks/readai/analyze.ts` | Haiku call via Vercel AI Gateway; returns structured analysis |
| `src/lib/webhooks/readai/document.ts` | Meeting document builder (frontmatter + body) |
| `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.ts` | POST handler — orchestrates all steps |
| `src/lib/webhooks/readai/schema.test.ts` | Schema parse tests |
| `src/lib/webhooks/readai/verify.test.ts` | HMAC verification tests |
| `src/lib/webhooks/readai/dedup.test.ts` | Deduplication tests |
| `src/lib/webhooks/readai/analyze.test.ts` | Haiku analysis tests |
| `src/lib/webhooks/readai/document.test.ts` | Document builder tests |
| `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.test.ts` | Route integration tests |

---

## Task 0: Install Dependencies

**Files:**
- Modify: `package.json` (via pnpm)

- [ ] **Step 1: Add AI SDK packages**

```bash
pnpm add ai @ai-sdk/gateway
```

- [ ] **Step 2: Verify build still passes**

```bash
pnpm build
```

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add ai and @ai-sdk/gateway for Read.ai webhook Haiku analysis"
```

---

## Task 1: Zod Schemas

**Files:**
- Create: `src/lib/webhooks/readai/schema.ts`
- Create: `src/lib/webhooks/readai/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webhooks/readai/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ReadAiPayloadSchema, HaikuAnalysisSchema } from './schema';

describe('ReadAiPayloadSchema', () => {
  it('parses a full payload', () => {
    const result = ReadAiPayloadSchema.safeParse({
      request_id: 'req_abc123',
      session_id: 'sess_xyz',
      title: 'Quarterly Review',
      summary: 'We discussed roadmap.',
      meeting_date: '2026-06-07T14:00:00Z',
      platform: 'zoom',
      report_url: 'https://app.read.ai/sessions/abc123',
      participants: [{ name: 'Jane Smith', email: 'jane@acme.com' }],
      topics: ['Roadmap', 'Budget'],
      action_items: ['Send proposal'],
      chapter_summaries: [{ title: 'Intro', summary: 'Quick intro.' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.request_id).toBe('req_abc123');
      expect(result.data.participants).toHaveLength(1);
    }
  });

  it('defaults optional arrays to empty', () => {
    const result = ReadAiPayloadSchema.safeParse({
      request_id: 'req_1',
      session_id: 'sess_1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.participants).toEqual([]);
      expect(result.data.topics).toEqual([]);
      expect(result.data.action_items).toEqual([]);
      expect(result.data.chapter_summaries).toEqual([]);
    }
  });

  it('fails when request_id is missing', () => {
    const result = ReadAiPayloadSchema.safeParse({ session_id: 'sess_1' });
    expect(result.success).toBe(false);
  });
});

describe('HaikuAnalysisSchema', () => {
  it('parses a valid high-confidence result', () => {
    const result = HaikuAnalysisSchema.safeParse({
      client: 'Acme Corp',
      client_slug: 'acme-corp',
      confidence: 'high',
      tags: ['quarterly-review'],
      summary: 'Met to review Q2.',
      action_items: ['Send proposal'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid confidence value', () => {
    const result = HaikuAnalysisSchema.safeParse({
      client: 'Acme Corp',
      client_slug: 'acme-corp',
      confidence: 'very-high',
      tags: [],
      summary: '',
      action_items: [],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/lib/webhooks/readai/schema.test.ts
```

Expected: FAIL — "Cannot find module './schema'"

- [ ] **Step 3: Implement `schema.ts`**

Create `src/lib/webhooks/readai/schema.ts`:

```ts
import { z } from 'zod';

export const ReadAiParticipantSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
});

export const ReadAiPayloadSchema = z.object({
  request_id: z.string(),
  session_id: z.string(),
  title: z.string().optional().default(''),
  summary: z.string().optional().default(''),
  meeting_date: z.string().optional(),
  platform: z.string().optional(),
  report_url: z.string().optional(),
  participants: z.array(ReadAiParticipantSchema).optional().default([]),
  topics: z.array(z.string()).optional().default([]),
  action_items: z.array(z.string()).optional().default([]),
  chapter_summaries: z
    .array(
      z.object({
        title: z.string().optional(),
        summary: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run src/lib/webhooks/readai/schema.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/webhooks/readai/schema.ts src/lib/webhooks/readai/schema.test.ts
git commit -m "feat: add Zod schemas for Read.ai payload and Haiku analysis"
```

---

## Task 2: HMAC-SHA256 Verification

**Files:**
- Create: `src/lib/webhooks/readai/verify.ts`
- Create: `src/lib/webhooks/readai/verify.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webhooks/readai/verify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyReadAiSignature } from './verify';

const SIGNING_KEY_BYTES = Buffer.from('my-secret-signing-key-32-chars!!');
const SIGNING_KEY_B64 = SIGNING_KEY_BYTES.toString('base64');

function makeSignature(body: string): string {
  return createHmac('sha256', SIGNING_KEY_BYTES).update(body, 'utf-8').digest('hex');
}

describe('verifyReadAiSignature', () => {
  it('returns true for a valid signature', () => {
    const body = '{"request_id":"req_1"}';
    const sig = makeSignature(body);
    expect(verifyReadAiSignature(body, sig, SIGNING_KEY_B64)).toBe(true);
  });

  it('returns false when the body has been tampered', () => {
    const body = '{"request_id":"req_1"}';
    const sig = makeSignature(body);
    const tampered = '{"request_id":"req_evil"}';
    expect(verifyReadAiSignature(tampered, sig, SIGNING_KEY_B64)).toBe(false);
  });

  it('returns false when the signing key is wrong', () => {
    const body = '{"request_id":"req_1"}';
    const wrongKey = Buffer.from('wrong-key-entirely-32-chars!!!!!').toString('base64');
    const sig = makeSignature(body);
    expect(verifyReadAiSignature(body, sig, wrongKey)).toBe(false);
  });

  it('returns false when the signature is empty', () => {
    const body = '{"request_id":"req_1"}';
    expect(verifyReadAiSignature(body, '', SIGNING_KEY_B64)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/lib/webhooks/readai/verify.test.ts
```

Expected: FAIL — "Cannot find module './verify'"

- [ ] **Step 3: Implement `verify.ts`**

Create `src/lib/webhooks/readai/verify.ts`:

```ts
import { createHmac, timingSafeEqual } from 'crypto';

export function verifyReadAiSignature(rawBody: string, signature: string, signingKey: string): boolean {
  if (!signature) return false;
  const keyBytes = Buffer.from(signingKey, 'base64');
  const expected = createHmac('sha256', keyBytes).update(rawBody, 'utf-8').digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run src/lib/webhooks/readai/verify.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/webhooks/readai/verify.ts src/lib/webhooks/readai/verify.test.ts
git commit -m "feat: add HMAC-SHA256 signature verification for Read.ai webhook"
```

---

## Task 3: Request ID Deduplication

**Files:**
- Create: `src/lib/webhooks/readai/dedup.ts`
- Create: `src/lib/webhooks/readai/dedup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webhooks/readai/dedup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NestStorage } from '@promptowl/contextnest-engine';
import { isDuplicate } from './dedup';

const makeStorage = (docs: unknown[]) =>
  ({ discoverDocuments: vi.fn().mockResolvedValue(docs) }) as unknown as NestStorage;

const makeDoc = (id: string, requestId: string) => ({
  id,
  frontmatter: { title: 'test', metadata: { request_id: requestId } },
});

describe('isDuplicate', () => {
  it('returns true when a meetings/ doc has a matching request_id', async () => {
    const storage = makeStorage([makeDoc('meetings/sess_1', 'req_abc')]);
    expect(await isDuplicate(storage, 'req_abc')).toBe(true);
  });

  it('returns false when no doc has a matching request_id', async () => {
    const storage = makeStorage([makeDoc('meetings/sess_1', 'req_other')]);
    expect(await isDuplicate(storage, 'req_abc')).toBe(false);
  });

  it('returns false when storage is empty', async () => {
    const storage = makeStorage([]);
    expect(await isDuplicate(storage, 'req_abc')).toBe(false);
  });

  it('ignores non-meetings/ docs', async () => {
    const storage = makeStorage([makeDoc('clients/registry', 'req_abc')]);
    expect(await isDuplicate(storage, 'req_abc')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/lib/webhooks/readai/dedup.test.ts
```

Expected: FAIL — "Cannot find module './dedup'"

- [ ] **Step 3: Implement `dedup.ts`**

Create `src/lib/webhooks/readai/dedup.ts`:

```ts
import type { NestStorage } from '@promptowl/contextnest-engine';

export async function isDuplicate(storage: NestStorage, requestId: string): Promise<boolean> {
  const docs = await storage.discoverDocuments();
  return docs.some(
    (node) =>
      node.id.startsWith('meetings/') &&
      node.frontmatter.metadata?.request_id === requestId,
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run src/lib/webhooks/readai/dedup.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/webhooks/readai/dedup.ts src/lib/webhooks/readai/dedup.test.ts
git commit -m "feat: add request_id deduplication for Read.ai webhook"
```

---

## Task 4: Haiku Analysis

**Files:**
- Create: `src/lib/webhooks/readai/analyze.ts`
- Create: `src/lib/webhooks/readai/analyze.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webhooks/readai/analyze.test.ts`:

```ts
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
  meeting_date: '2026-06-07T14:00:00Z',
  platform: 'zoom',
  report_url: 'https://app.read.ai/sessions/sess_1',
  participants: [{ name: 'Jane Smith', email: 'jane@acme.com' }],
  topics: ['Roadmap'],
  action_items: ['Send proposal'],
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

  it('forces client to unknown when confidence is low', async () => {
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
    expect(result.client_slug).toBe('unknown');
    expect(result.haiku_error).toBeUndefined();
  });

  it('returns unknown with haiku_error when generateText throws', async () => {
    mockGenerateText.mockRejectedValue(new Error('API down'));
    const result = await analyzeMeeting(PAYLOAD, '');
    expect(result.client_slug).toBe('unknown');
    expect(result.haiku_error).toBe(true);
  });

  it('includes registry text in the prompt', async () => {
    mockGenerateText.mockResolvedValue({ text: VALID_RESPONSE } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);
    await analyzeMeeting(PAYLOAD, '### Special Client\n- domains: special.com');
    const call = mockGenerateText.mock.calls[0][0];
    expect(call.prompt).toContain('Special Client');
    expect(call.prompt).toContain('Quarterly Review');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/lib/webhooks/readai/analyze.test.ts
```

Expected: FAIL — "Cannot find module './analyze'"

- [ ] **Step 3: Implement `analyze.ts`**

Create `src/lib/webhooks/readai/analyze.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run src/lib/webhooks/readai/analyze.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/webhooks/readai/analyze.ts src/lib/webhooks/readai/analyze.test.ts
git commit -m "feat: add Haiku analysis via Vercel AI Gateway for Read.ai meetings"
```

---

## Task 5: Meeting Document Builder

**Files:**
- Create: `src/lib/webhooks/readai/document.ts`
- Create: `src/lib/webhooks/readai/document.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/webhooks/readai/document.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMeetingDocument } from './document';
import type { ReadAiPayload, HaikuAnalysis } from './schema';

const PAYLOAD: ReadAiPayload = {
  request_id: 'req_abc123',
  session_id: 'sess_xyz',
  title: 'Quarterly Review',
  summary: 'Original summary.',
  meeting_date: '2026-06-07T14:00:00Z',
  platform: 'zoom',
  report_url: 'https://app.read.ai/sessions/sess_xyz',
  participants: [
    { name: 'Jane Smith', email: 'jane@acme.com' },
    { name: 'John', email: undefined },
  ],
  topics: ['Roadmap', 'Budget'],
  action_items: ['Send proposal'],
  chapter_summaries: [],
};

const ANALYSIS: HaikuAnalysis = {
  client: 'Acme Corp',
  client_slug: 'acme-corp',
  confidence: 'high',
  tags: ['quarterly-review', 'budget'],
  summary: 'We discussed Q2 roadmap and budget allocation.',
  action_items: ['Send updated proposal to Jane'],
};

describe('buildMeetingDocument', () => {
  it('generates correct document id from session_id', () => {
    const { id } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(id).toBe('meetings/sess_xyz');
  });

  it('sets title combining client and meeting title', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(frontmatter.title).toBe('Acme Corp — Quarterly Review');
  });

  it('sets type to document and status to published', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(frontmatter.type).toBe('document');
    expect(frontmatter.status).toBe('published');
  });

  it('puts meeting fields in metadata', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    const m = frontmatter.metadata!;
    expect(m.document_type).toBe('meeting');
    expect(m.client).toBe('acme-corp');
    expect(m.meeting_date).toBe('2026-06-07T14:00:00Z');
    expect(m.platform).toBe('zoom');
    expect(m.report_url).toBe('https://app.read.ai/sessions/sess_xyz');
    expect(m.request_id).toBe('req_abc123');
    expect(m.source).toBe('readai');
    expect(m.haiku_confidence).toBe('high');
  });

  it('includes participant emails in metadata participants', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    const participants = frontmatter.metadata!.participants as string[];
    expect(participants).toContain('jane@acme.com');
    expect(participants).toContain('John');
  });

  it('includes haiku_error in metadata when present', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, { ...ANALYSIS, haiku_error: true });
    expect(frontmatter.metadata!.haiku_error).toBe(true);
  });

  it('omits haiku_error from metadata when absent', () => {
    const { frontmatter } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect('haiku_error' in (frontmatter.metadata ?? {})).toBe(false);
  });

  it('body contains ## Summary with Haiku summary text', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Summary');
    expect(body).toContain('We discussed Q2 roadmap and budget allocation.');
  });

  it('body contains ## Action Items from analysis', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Action Items');
    expect(body).toContain('Send updated proposal to Jane');
  });

  it('body contains ## Topics from payload', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Topics');
    expect(body).toContain('Roadmap');
    expect(body).toContain('Budget');
  });

  it('body contains ## Participants', () => {
    const { body } = buildMeetingDocument(PAYLOAD, ANALYSIS);
    expect(body).toContain('## Participants');
    expect(body).toContain('jane@acme.com');
  });

  it('uses payload summary when Haiku summary is empty', () => {
    const { body } = buildMeetingDocument(PAYLOAD, { ...ANALYSIS, summary: '' });
    expect(body).toContain('Original summary.');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/lib/webhooks/readai/document.test.ts
```

Expected: FAIL — "Cannot find module './document'"

- [ ] **Step 3: Implement `document.ts`**

Create `src/lib/webhooks/readai/document.ts`:

```ts
import type { Frontmatter } from '@promptowl/contextnest-engine';
import type { ReadAiPayload, HaikuAnalysis } from './schema';

export interface MeetingDocumentParts {
  id: string;
  frontmatter: Frontmatter;
  body: string;
}

export function buildMeetingDocument(
  payload: ReadAiPayload,
  analysis: HaikuAnalysis & { haiku_error?: boolean },
): MeetingDocumentParts {
  const id = `meetings/${payload.session_id}`;

  const participants = payload.participants
    .map((p) => p.email || p.name)
    .filter((v): v is string => Boolean(v));

  const metadata: Record<string, unknown> = {
    document_type: 'meeting',
    client: analysis.client_slug,
    meeting_date: payload.meeting_date,
    participants,
    platform: payload.platform,
    report_url: payload.report_url,
    request_id: payload.request_id,
    source: 'readai',
    haiku_confidence: analysis.confidence,
  };

  if (analysis.haiku_error) {
    metadata.haiku_error = true;
  }

  const frontmatter: Frontmatter = {
    title: `${analysis.client} — ${payload.title || 'Meeting'}`,
    type: 'document',
    status: 'published',
    tags: analysis.tags,
    metadata,
  };

  return { id, frontmatter, body: buildBody(payload, analysis) };
}

function buildBody(
  payload: ReadAiPayload,
  analysis: HaikuAnalysis,
): string {
  const lines: string[] = [];

  lines.push('## Summary', '', analysis.summary || payload.summary || '', '');

  if (analysis.action_items.length > 0) {
    lines.push('## Action Items', '');
    analysis.action_items.forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }

  if (payload.topics.length > 0) {
    lines.push('## Topics', '');
    payload.topics.forEach((topic) => lines.push(`- ${topic}`));
    lines.push('');
  }

  if (payload.participants.length > 0) {
    lines.push('## Participants', '');
    payload.participants.forEach((p) => {
      const label =
        p.name && p.email
          ? `${p.name} (${p.email})`
          : p.name || p.email || 'unknown';
      lines.push(`- ${label}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run src/lib/webhooks/readai/document.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/webhooks/readai/document.ts src/lib/webhooks/readai/document.test.ts
git commit -m "feat: add meeting document builder for Read.ai webhook"
```

---

## Task 6: Route Handler

**Files:**
- Create: `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.ts`
- Create: `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

vi.mock('@/lib/vault/index', () => ({
  createEngine: vi.fn(),
}));

vi.mock('@/lib/webhooks/readai/verify', () => ({
  verifyReadAiSignature: vi.fn(),
}));

vi.mock('@/lib/webhooks/readai/dedup', () => ({
  isDuplicate: vi.fn(),
}));

vi.mock('@/lib/webhooks/readai/analyze', () => ({
  analyzeMeeting: vi.fn(),
}));

vi.mock('@/lib/webhooks/readai/document', () => ({
  buildMeetingDocument: vi.fn(),
}));

vi.mock('@promptowl/contextnest-engine', () => ({
  publishDocument: vi.fn().mockResolvedValue(undefined),
  serializeDocument: vi.fn().mockReturnValue('serialized-content'),
}));

import { createEngine } from '@/lib/vault/index';
import { verifyReadAiSignature } from '@/lib/webhooks/readai/verify';
import { isDuplicate } from '@/lib/webhooks/readai/dedup';
import { analyzeMeeting } from '@/lib/webhooks/readai/analyze';
import { buildMeetingDocument } from '@/lib/webhooks/readai/document';
import { publishDocument } from '@promptowl/contextnest-engine';
import { POST } from './route';

const API_KEY = 'test-api-key-secret';
const VAULT_ID = 'my-vault';
const SIGNING_KEY_B64 = Buffer.from('test-signing-key-32-chars!!!!!').toString('base64');

const VALID_PAYLOAD = JSON.stringify({
  request_id: 'req_abc123',
  session_id: 'sess_xyz',
  title: 'Quarterly Review',
  summary: 'Meeting summary.',
  meeting_date: '2026-06-07T14:00:00Z',
  platform: 'zoom',
  report_url: 'https://app.read.ai/sessions/sess_xyz',
  participants: [],
  topics: [],
  action_items: [],
  chapter_summaries: [],
});

const mockStorage = {
  discoverDocuments: vi.fn().mockResolvedValue([]),
  readDocument: vi.fn().mockResolvedValue(null),
  writeDocument: vi.fn().mockResolvedValue(undefined),
  regenerateIndex: vi.fn().mockResolvedValue(undefined),
};

const mockSync = {
  commitFile: vi.fn().mockResolvedValue(undefined),
};

function makeRequest(body: string, overrides: { apikey?: string; vaultId?: string } = {}) {
  const apikey = overrides.apikey ?? API_KEY;
  const vaultId = overrides.vaultId ?? VAULT_ID;
  return new NextRequest(`http://localhost/api/webhooks/${apikey}/${vaultId}/readai`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-read-signature': 'valid-sig' },
  });
}

describe('POST /api/webhooks/[apikey]/[vaultId]/readai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_API_KEY = API_KEY;
    process.env.READ_AI_SIGNING_KEY = SIGNING_KEY_B64;
    process.env.BOT_GITHUB_TOKEN = 'bot-token';

    vi.mocked(createEngine).mockReturnValue({
      storage: mockStorage as unknown as ReturnType<typeof createEngine>['storage'],
      sync: mockSync as unknown as ReturnType<typeof createEngine>['sync'],
      userToken: 'bot-token',
    });
    vi.mocked(verifyReadAiSignature).mockReturnValue(true);
    vi.mocked(isDuplicate).mockResolvedValue(false);
    vi.mocked(analyzeMeeting).mockResolvedValue({
      client: 'Acme Corp',
      client_slug: 'acme-corp',
      confidence: 'high',
      tags: [],
      summary: 'Summary.',
      action_items: [],
    });
    vi.mocked(buildMeetingDocument).mockReturnValue({
      id: 'meetings/sess_xyz',
      frontmatter: { title: 'Acme Corp — Quarterly Review', type: 'document', status: 'published' },
      body: 'body text',
    });
  });

  it('returns 200 and writes document for a valid request', async () => {
    const req = makeRequest(VALID_PAYLOAD);
    const res = await POST(req, { params: Promise.resolve({ apikey: API_KEY, vaultId: VAULT_ID }) });
    expect(res.status).toBe(200);
    expect(mockStorage.writeDocument).toHaveBeenCalledWith('meetings/sess_xyz', 'serialized-content');
    expect(publishDocument).toHaveBeenCalled();
    expect(mockStorage.regenerateIndex).toHaveBeenCalled();
  });

  it('returns 401 for wrong path key', async () => {
    const req = makeRequest(VALID_PAYLOAD, { apikey: 'wrong-key' });
    const res = await POST(req, { params: Promise.resolve({ apikey: 'wrong-key', vaultId: VAULT_ID }) });
    expect(res.status).toBe(401);
    expect(mockStorage.writeDocument).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid HMAC signature', async () => {
    vi.mocked(verifyReadAiSignature).mockReturnValue(false);
    const req = makeRequest(VALID_PAYLOAD);
    const res = await POST(req, { params: Promise.resolve({ apikey: API_KEY, vaultId: VAULT_ID }) });
    expect(res.status).toBe(401);
    expect(mockStorage.writeDocument).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid vault id format', async () => {
    const req = makeRequest(VALID_PAYLOAD, { vaultId: 'INVALID VAULT' });
    const res = await POST(req, { params: Promise.resolve({ apikey: API_KEY, vaultId: 'INVALID VAULT' }) });
    expect(res.status).toBe(400);
  });

  it('returns 200 without writing for a duplicate request_id', async () => {
    vi.mocked(isDuplicate).mockResolvedValue(true);
    const req = makeRequest(VALID_PAYLOAD);
    const res = await POST(req, { params: Promise.resolve({ apikey: API_KEY, vaultId: VAULT_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(mockStorage.writeDocument).not.toHaveBeenCalled();
  });

  it('returns 500 when vault write fails', async () => {
    mockStorage.writeDocument.mockRejectedValue(new Error('Blob write failed'));
    const req = makeRequest(VALID_PAYLOAD);
    const res = await POST(req, { params: Promise.resolve({ apikey: API_KEY, vaultId: VAULT_ID }) });
    expect(res.status).toBe(500);
  });

  it('proceeds with empty registry when clients/registry is missing', async () => {
    mockStorage.readDocument.mockResolvedValue(null);
    const req = makeRequest(VALID_PAYLOAD);
    const res = await POST(req, { params: Promise.resolve({ apikey: API_KEY, vaultId: VAULT_ID }) });
    expect(res.status).toBe(200);
    expect(analyzeMeeting).toHaveBeenCalledWith(expect.anything(), '');
  });

  it('fires git sync as fire-and-forget (does not block response)', async () => {
    mockSync.commitFile.mockRejectedValue(new Error('git down'));
    const req = makeRequest(VALID_PAYLOAD);
    const res = await POST(req, { params: Promise.resolve({ apikey: API_KEY, vaultId: VAULT_ID }) });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run "src/app/api/webhooks/\[apikey\]/\[vaultId\]/readai/route.test.ts"
```

Expected: FAIL — "Cannot find module" for the route

- [ ] **Step 3: Create the route directory and handler**

Create `src/app/api/webhooks/[apikey]/[vaultId]/readai/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import {
  publishDocument,
  serializeDocument,
} from '@promptowl/contextnest-engine';
import { createEngine } from '@/lib/vault/index';
import { verifyReadAiSignature } from '@/lib/webhooks/readai/verify';
import { ReadAiPayloadSchema } from '@/lib/webhooks/readai/schema';
import { isDuplicate } from '@/lib/webhooks/readai/dedup';
import { analyzeMeeting } from '@/lib/webhooks/readai/analyze';
import { buildMeetingDocument } from '@/lib/webhooks/readai/document';

export const maxDuration = 60;

const VAULT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

interface RouteContext {
  params: Promise<{ apikey: string; vaultId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { apikey, vaultId: rawVaultId } = await params;

  // Step 1: Path key check (timing-safe)
  const webhookApiKey = process.env.WEBHOOK_API_KEY ?? '';
  if (
    apikey.length !== webhookApiKey.length ||
    !timingSafeEqual(Buffer.from(apikey), Buffer.from(webhookApiKey))
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Step 1a: Vault ID validation
  const resolvedVaultId =
    rawVaultId === 'default'
      ? (process.env.CONTEXTNEST_DEFAULT_VAULT_ID ?? 'default')
      : rawVaultId;
  if (!VAULT_ID_RE.test(resolvedVaultId)) {
    return NextResponse.json({ error: 'invalid vault id' }, { status: 400 });
  }

  // Step 2: HMAC-SHA256 body verification
  const rawBody = await req.text();
  const signature = req.headers.get('x-read-signature') ?? '';
  const signingKey = process.env.READ_AI_SIGNING_KEY ?? '';
  if (!verifyReadAiSignature(rawBody, signature, signingKey)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Parse payload
  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = ReadAiPayloadSchema.safeParse(jsonBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  const payload = parsed.data;

  // Initialize vault engine with bot identity
  const botToken = process.env.BOT_GITHUB_TOKEN ?? '';
  const { storage, sync } = createEngine(botToken, resolvedVaultId);

  // Step 3: Deduplication
  if (await isDuplicate(storage, payload.request_id)) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  // Read client registry (missing registry is non-fatal)
  let registryText = '';
  try {
    const registryNode = await storage.readDocument('clients/registry');
    if (registryNode) registryText = registryNode.rawContent;
  } catch {
    // proceed with empty registry
  }

  // Haiku analysis (failure is non-fatal — document is always written)
  const analysis = await analyzeMeeting(payload, registryText);

  // Build document
  const { id, frontmatter, body } = buildMeetingDocument(payload, analysis);
  const node = {
    id,
    filePath: '',
    frontmatter,
    body: `\n${body}\n`,
    rawContent: '',
  };
  const content = serializeDocument(node);

  // Write to vault — throws on failure → 500 → triggers Read.ai retry
  await storage.writeDocument(id, content);
  await publishDocument(storage, id, {
    editedBy: 'skynest-bot',
    note: 'Ingested via Read.ai webhook',
  });
  await storage.regenerateIndex();

  // Fire-and-forget git sync
  sync
    .commitFile({
      path: `${id}.md`,
      content: Buffer.from(content, 'utf-8'),
      message: `ingest: meeting ${payload.session_id}`,
      userToken: botToken,
    })
    .catch(console.error);

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run "src/app/api/webhooks/\[apikey\]/\[vaultId\]/readai/route.test.ts"
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks src/app/api/webhooks/[apikey] src/app/api/webhooks/[apikey]/[vaultId] src/app/api/webhooks/[apikey]/[vaultId]/readai/route.ts src/app/api/webhooks/[apikey]/[vaultId]/readai/route.test.ts
git commit -m "feat: add Read.ai webhook route POST /api/webhooks/[apikey]/[vaultId]/readai"
```

---

## Task 7: Full Test Suite + Build Verification

**Files:** no new files

- [ ] **Step 1: Run the full webhook test suite**

```bash
pnpm vitest run src/lib/webhooks src/app/api/webhooks
```

Expected: all tests PASS with no failures

- [ ] **Step 2: Run full project build**

```bash
pnpm build
```

Expected: build completes with no TypeScript errors

- [ ] **Step 3: Run linter**

```bash
pnpm lint
```

Expected: no lint errors

- [ ] **Step 4: Commit if any lint fixes were needed**

```bash
git add -p
git commit -m "fix: lint cleanup for Read.ai webhook implementation"
```

(Only needed if lint auto-fixed anything in step 3.)

---

## Environment Variables Required

Add to `.env.local` (local dev) and Vercel project settings (production):

| Variable | Example | Description |
|---|---|---|
| `WEBHOOK_API_KEY` | `582941c27dd66c9e7feca5b5d43c9ae506ffda06` | Secret path segment in webhook URL |
| `READ_AI_SIGNING_KEY` | `<base64 from Read.ai dashboard>` | Base64-encoded HMAC signing key |
| `BOT_GITHUB_TOKEN` | `ghp_...` | GitHub PAT with `repo` scope for bot commits |
| `VERCEL_AI_GATEWAY_KEY` | `vai_...` | Vercel AI Gateway API key |

**Webhook URL to configure in Read.ai dashboard:**
```
https://your-deployment.vercel.app/api/webhooks/<WEBHOOK_API_KEY>/<vault-id>/readai
```
