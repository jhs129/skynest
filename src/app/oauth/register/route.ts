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
    // No secret: open registration allowed only for loopback redirect URIs.
    // MCP native clients (Claude Code) always use http://localhost:<port> callbacks.
    // Non-loopback URIs without a secret would enable OAuth phishing via redirect.
    const nonLoopback = redirect_uris.filter(uri => !isLoopback(uri));
    if (nonLoopback.length > 0) {
      return NextResponse.json(
        {
          error: 'invalid_redirect_uri',
          error_description:
            'Non-loopback redirect URIs require OAUTH_REGISTRATION_SECRET to be configured',
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
