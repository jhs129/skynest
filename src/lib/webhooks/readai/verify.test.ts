import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyReadAiSignature } from './verify';

// Test signing key as base64 (simulates what Read.ai dashboard provides)
const RAW_KEY = 'super-secret-signing-key-for-testing';
const BASE64_KEY = Buffer.from(RAW_KEY).toString('base64');

function makeSignature(body: string): string {
  return createHmac('sha256', RAW_KEY).update(body).digest('hex');
}

describe('verifyReadAiSignature', () => {
  it('returns true for a valid signature', () => {
    const body = JSON.stringify({ request_id: 'req_123' });
    const sig = makeSignature(body);
    expect(verifyReadAiSignature(body, sig, BASE64_KEY)).toBe(true);
  });

  it('returns false when the body is tampered', () => {
    const body = JSON.stringify({ request_id: 'req_123' });
    const sig = makeSignature(body);
    const tamperedBody = JSON.stringify({ request_id: 'req_TAMPERED' });
    expect(verifyReadAiSignature(tamperedBody, sig, BASE64_KEY)).toBe(false);
  });

  it('returns false when the signature is wrong', () => {
    const body = JSON.stringify({ request_id: 'req_123' });
    expect(verifyReadAiSignature(body, 'deadbeefdeadbeef', BASE64_KEY)).toBe(false);
  });

  it('returns false when the signing key is wrong', () => {
    const body = JSON.stringify({ request_id: 'req_123' });
    const sig = makeSignature(body);
    const wrongKey = Buffer.from('wrong-key').toString('base64');
    expect(verifyReadAiSignature(body, sig, wrongKey)).toBe(false);
  });

  it('returns false when signature is empty string', () => {
    const body = JSON.stringify({ request_id: 'req_123' });
    expect(verifyReadAiSignature(body, '', BASE64_KEY)).toBe(false);
  });

  it('returns false when signing key is empty string', () => {
    const body = JSON.stringify({ request_id: 'req_123' });
    const sig = makeSignature(body);
    expect(verifyReadAiSignature(body, sig, '')).toBe(false);
  });
});
