import { describe, it, expect, vi } from 'vitest';
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

  it('handles docs with missing frontmatter gracefully', async () => {
    const storage = makeStorage([{ id: 'meetings/sess_1' }]);
    expect(await isDuplicate(storage, 'req_abc')).toBe(false);
  });

  it('handles docs with missing metadata gracefully', async () => {
    const storage = makeStorage([{ id: 'meetings/sess_1', frontmatter: { title: 'test' } }]);
    expect(await isDuplicate(storage, 'req_abc')).toBe(false);
  });
});
