import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthCode, signAccessToken } from '@/lib/oauth/jwt';
import { verifyPkce } from '@/lib/oauth/pkce';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { ACCESS_TOKEN_TTL_SECONDS } from '@/lib/oauth/config';
import { createAuthorizationProvider } from '@/lib/authorization/authorization-factory';

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const grantType = body.get('grant_type');

  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  const code = body.get('code') as string | null;
  const codeVerifier = body.get('code_verifier') as string | null;
  const redirectUri = body.get('redirect_uri') as string | null;

  if (!code || !codeVerifier || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  let claims;
  try {
    claims = await verifyAuthCode(code);
  } catch {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  const pkceValid = verifyPkce({
    codeVerifier,
    codeChallenge: claims.codeChallenge,
    codeChallengeMethod: 'S256',
  });
  if (!pkceValid) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  if (claims.redirectUri !== redirectUri) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  let scope: string;
  try {
    const authorizationProvider = createAuthorizationProvider();
    const access = await authorizationProvider.checkAccess({
      idpAccessToken: claims.idpAccessToken,
      idpGroups: claims.idpGroups,
    });

    if (access === 'none') {
      return NextResponse.json(
        {
          error: 'access_denied',
          error_description: 'Your account does not have read or write access to this vault.',
        },
        { status: 403 },
      );
    }

    scope = access === 'write' ? 'mcp:read mcp:write' : 'mcp:read';
  } catch (err) {
    return NextResponse.json(
      { error: 'server_error', error_description: (err as Error).message },
      { status: 500 },
    );
  }

  const { baseUrl } = await resolveServerUrls();
  const audience = `${baseUrl.origin}/api/mcp`;

  const { token: accessToken } = await signAccessToken({
    userId: claims.sub,
    clientId: claims.clientId,
    scope,
    issuer: baseUrl.origin,
    audience,
    extra: {
      userToken: claims.idpAccessToken,
      userLogin: claims.idpLogin,
    },
  });

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
    },
  });
}
