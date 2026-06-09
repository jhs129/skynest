import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { registerClient } from '@/lib/oauth/clients';

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

function isLoopback(uri: string): boolean {
  try {
    return LOOPBACK.test(uri);
  } catch {
    return false;
  }
}

// RFC 8252 §7.1 — custom URI schemes (e.g. myapp://) are safe for native apps.
function isCustomScheme(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol !== 'http:' && protocol !== 'https:';
  } catch {
    return false;
  }
}

// Allows HTTPS redirect URIs whose origin appears in OAUTH_ALLOWED_REDIRECT_ORIGINS.
// Needed for desktop apps that use a web-based OAuth callback (e.g. Claude Desktop → https://claude.ai/...).
function isAllowedOrigin(uri: string, allowedOrigins: string[]): boolean {
  try {
    const { origin } = new URL(uri);
    return allowedOrigins.some((o) => origin === o || uri.startsWith(o));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const registrationSecret = process.env.OAUTH_REGISTRATION_SECRET;

  const body = (await req.json()) as { client_name?: string; redirect_uris?: string[] };
  const { client_name, redirect_uris } = body;

  if (!client_name || !redirect_uris?.length) {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  if (redirect_uris.length > 16) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  if (registrationSecret) {
    // Secret configured: require matching Bearer token (timing-safe comparison).
    const authHeader = req.headers.get('authorization') ?? '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const secretBuf = Buffer.from(registrationSecret, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    const match =
      secretBuf.byteLength === providedBuf.byteLength &&
      crypto.timingSafeEqual(secretBuf, providedBuf);
    if (!match) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    // No secret: allow loopback (Claude Code CLI), custom schemes (native apps per RFC 8252 §7.1),
    // and HTTPS origins listed in OAUTH_ALLOWED_REDIRECT_ORIGINS (e.g. Claude Desktop via https://claude.ai).
    // Pure HTTPS non-loopback URIs without explicit allowlisting would enable OAuth phishing.
    const allowedOrigins = (process.env.OAUTH_ALLOWED_REDIRECT_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const disallowed = redirect_uris.filter(
      (uri) => !isLoopback(uri) && !isCustomScheme(uri) && !isAllowedOrigin(uri, allowedOrigins),
    );
    if (disallowed.length > 0) {
      return NextResponse.json(
        {
          error: 'invalid_redirect_uri',
          error_description:
            'Non-loopback redirect URIs require OAUTH_REGISTRATION_SECRET or OAUTH_ALLOWED_REDIRECT_ORIGINS to be configured',
        },
        { status: 400 },
      );
    }
  }

  const clientId = `mcpc_${crypto.randomBytes(16).toString('hex')}`;
  await registerClient(clientId, { name: client_name, redirectUris: redirect_uris });

  return NextResponse.json(
    {
      client_id: clientId,
      client_name,
      redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 },
  );
}
