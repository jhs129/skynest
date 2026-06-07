import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { signAuthCode } from '@/lib/oauth/jwt';
import { getClient } from '@/lib/oauth/clients';
import { parseAuthorizeParams } from '@/lib/oauth/authorize';
import { resolveServerUrls } from '@/lib/oauth/urls';

export async function GET(req: NextRequest) {
  const validation = parseAuthorizeParams(req.nextUrl.searchParams);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, error_description: validation.errorDescription },
      { status: validation.httpStatus },
    );
  }

  const { params } = validation;

  const client = getClient(params.clientId);
  if (!client || !client.redirectUris.includes(params.redirectUri)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    const { baseUrl } = await resolveServerUrls();
    const loginUrl = new URL('/api/auth/signin', baseUrl);
    loginUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(loginUrl);
  }

  const code = await signAuthCode({
    sub: session.user.email!,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    githubAccessToken:
      (session as { githubAccessToken?: string }).githubAccessToken ?? '',
    githubLogin:
      (session as { githubLogin?: string }).githubLogin ?? session.user.name ?? '',
  });

  const redirect = new URL(params.redirectUri);
  redirect.searchParams.set('code', code);
  if (params.state) redirect.searchParams.set('state', params.state);
  return NextResponse.redirect(redirect);
}
