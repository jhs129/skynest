// Per-request URL resolution. Vercel forwards the original host on
// x-forwarded-host; we honor it so the issuer/resource URLs in OAuth metadata
// match what the client actually called.
import { headers } from 'next/headers';

export async function resolveServerUrls(): Promise<{
  baseUrl: URL;
  issuer: URL;
  resourceUrl: URL;
}> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) {
    throw new Error('Missing host header');
  }
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https');
  const baseUrl = new URL(`${proto}://${host}`);
  return {
    baseUrl,
    issuer: baseUrl,
    resourceUrl: new URL('/api/mcp', baseUrl),
  };
}
