import { createHmac, timingSafeEqual } from 'crypto';

export function verifyReadAiSignature(
  body: string,
  signature: string,
  base64SigningKey: string,
): boolean {
  if (!signature || !base64SigningKey) return false;

  let signingKey: Buffer;
  try {
    signingKey = Buffer.from(base64SigningKey, 'base64');
  } catch {
    return false;
  }

  const expected = createHmac('sha256', signingKey).update(body).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }

  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
