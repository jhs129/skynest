import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthCode, signAccessToken } from '@/lib/oauth/jwt';
import { verifyPkce } from '@/lib/oauth/pkce';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { ACCESS_TOKEN_TTL_SECONDS } from '@/lib/oauth/config';
import { checkRepoAccess } from '@/lib/github/repo-access';

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

  const vaultRepo = process.env.VAULT_REPO;
  if (!vaultRepo) {
    return NextResponse.json({ error: 'server_error', error_description: 'VAULT_REPO is not configured' }, { status: 500 });
  }

  const access = await checkRepoAccess(claims.githubAccessToken, vaultRepo);
  if (access === 'none') {
    return NextResponse.json(
      {
        error: 'access_denied',
        error_description: `Your GitHub account does not have access to the vault repository (${vaultRepo}). Contact the vault owner to request access.`,
      },
      { status: 403 },
    );
  }

  const scope = access === 'write' ? 'mcp:read mcp:write' : 'mcp:read';

  const { baseUrl } = await resolveServerUrls();
  const audience = `${baseUrl.origin}/api/mcp`;

  const { token: accessToken } = await signAccessToken({
    userId: claims.sub,
    clientId: claims.clientId,
    scope,
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
