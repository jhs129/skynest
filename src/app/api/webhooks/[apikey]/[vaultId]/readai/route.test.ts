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
