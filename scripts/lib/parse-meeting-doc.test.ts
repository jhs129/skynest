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
