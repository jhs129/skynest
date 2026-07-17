import { NextResponse } from 'next/server';
import { resolveServerUrls } from '@/lib/oauth/urls';
import { isMcpAuthDisabled } from '@/lib/mcp/auth';

export async function GET() {
  // With auth disabled, don't advertise an OAuth requirement at all — some MCP
  // clients discover this metadata eagerly and gate the connection on it before
  // ever attempting an unauthenticated request.
  if (isMcpAuthDisabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const { baseUrl } = await resolveServerUrls();
  const base = baseUrl.origin;
  const resource = `${base}/api/mcp`;
  const authorizationServers = [base];
  if (process.env.MCP_TRUSTED_ISSUER) {
    authorizationServers.push(process.env.MCP_TRUSTED_ISSUER);
  }
  return NextResponse.json({
    resource,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
}
