import { NextResponse } from 'next/server';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { isMcpAuthDisabled } from '@/lib/mcp/auth';

export async function GET() {
  // See the matching guard in oauth-protected-resource/route.ts.
  if (isMcpAuthDisabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const { baseUrl } = await resolveServerUrls();
  const base = baseUrl.origin;
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: ['mcp:read', 'mcp:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}
