import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { registerClient } from '@/lib/oauth/clients';

export async function POST(req: NextRequest) {
  const registrationSecret = process.env.OAUTH_REGISTRATION_SECRET;
  if (registrationSecret) {
    const authHeader = req.headers.get('authorization') ?? '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (provided !== registrationSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const body = (await req.json()) as { client_name?: string; redirect_uris?: string[] };
  const { client_name, redirect_uris } = body;

  if (!client_name || !redirect_uris?.length) {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  if (redirect_uris.length > 16) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  const clientId = `mcpc_${crypto.randomBytes(16).toString('hex')}`;
  registerClient(clientId, { name: client_name, redirectUris: redirect_uris });

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
