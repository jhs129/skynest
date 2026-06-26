import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {},
  { basePath: '/api', maxDuration: 60 },
);

const authHandler = withMcpAuth(
  handler,
  async (req: Request, bearerToken?: string) => {
    if (!bearerToken) return undefined;
    const url = new URL(req.url);
    // Respect x-forwarded-proto / x-forwarded-host set by TLS-terminating proxies
    // (Azure Container Apps, Vercel, etc.) so the computed audience matches the public URL.
    const proto =
      req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ??
      url.protocol.replace(':', '');
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ?? url.host;
    const resourceUrl = `${proto}://${host}/api/mcp`;
    return verifyMcpToken(bearerToken, resourceUrl);
  },
  { required: true },
);

export const GET = authHandler;
export const POST = authHandler;
export const DELETE = authHandler;
