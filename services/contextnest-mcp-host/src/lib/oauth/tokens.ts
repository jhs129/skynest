// Helpers for the opaque tokens we hand out: authorization codes (one-time,
// short-lived) and refresh tokens (long-lived, rotated on use).
import { createHash, randomBytes } from 'node:crypto';

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaque(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
