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

// withMcpAuth callback: (req: Request, bearerToken?: string) => AuthInfo | undefined | Promise<...>
const authHandler = withMcpAuth(
  handler,
  async (req: Request, bearerToken?: string) => {
    if (!bearerToken) return undefined;
    const url = new URL(req.url);
    const resourceUrl = `${url.origin}/api/mcp`;
    return verifyMcpToken(bearerToken, resourceUrl);
  },
  { required: true },
);

export const GET = authHandler;
export const POST = authHandler;
export const DELETE = authHandler;
