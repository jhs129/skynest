import { NextResponse } from 'next/server';
import { resolveServerUrls } from '@/lib/oauth/urls';

export async function GET() {
  const { baseUrl } = await resolveServerUrls();
  const base = baseUrl.origin;
  const resource = `${base}/api/mcp`;
  return NextResponse.json({
    resource,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
}
