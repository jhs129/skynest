// PKCE verification (RFC 7636). We only support the S256 method; plain is
// explicitly forbidden by OAuth 2.1.
import { createHash } from 'node:crypto';

export function verifyPkce(opts: {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}): boolean {
  if (opts.codeChallengeMethod !== 'S256') return false;
  // Verifier must be 43-128 chars of unreserved URI chars per RFC 7636 §4.1.
  if (opts.codeVerifier.length < 43 || opts.codeVerifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(opts.codeVerifier)) return false;
  const hash = createHash('sha256').update(opts.codeVerifier).digest();
  const computed = hash.toString('base64url');
  return timingSafeEqualString(computed, opts.codeChallenge);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
