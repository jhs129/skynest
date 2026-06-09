import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthCode, signAccessToken } from '@/lib/oauth/jwt';
import { verifyPkce } from '@/lib/oauth/pkce';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { ACCESS_TOKEN_TTL_SECONDS } from '@/lib/oauth/config';

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

  const { baseUrl } = await resolveServerUrls();
  const audience = `${baseUrl.origin}/api/mcp`;

  const { token: accessToken } = await signAccessToken({
    userId: claims.sub,
    clientId: claims.clientId,
    scope: 'mcp:read mcp:write',
    issuer: baseUrl.origin,
    audience,
    extra: {
      userToken: claims.githubAccessToken,
      userLogin: claims.githubLogin,
    },
  });

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: 'mcp:read mcp:write',
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
