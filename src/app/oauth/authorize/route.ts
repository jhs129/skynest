import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { signAuthCode } from '@/lib/oauth/jwt';
import { getClient, registerClient } from '@/lib/oauth/clients';
import { parseAuthorizeParams } from '@/lib/oauth/authorize';
import { resolveServerUrls } from '@/lib/oauth/urls';

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

export async function GET(req: NextRequest) {
  const validation = parseAuthorizeParams(req.nextUrl.searchParams);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, error_description: validation.errorDescription },
      { status: validation.httpStatus },
    );
  }

  const { params } = validation;

  let client = await getClient(params.clientId);

  // Auto-register clients that were registered before Blob persistence was added.
  // Claude Code caches its client_id locally; if it presents a valid mcpc_ id with a
  // loopback redirect URI we can safely re-persist it rather than forcing re-registration.
  if (!client && /^mcpc_[0-9a-f]+$/.test(params.clientId) && LOOPBACK.test(params.redirectUri)) {
    await registerClient(params.clientId, { name: 'MCP Client', redirectUris: [params.redirectUri] });
    client = { name: 'MCP Client', redirectUris: [params.redirectUri] };
  }

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
