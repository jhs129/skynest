import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';

// Cache one handler per vaultId — preserves in-memory Streamable HTTP session state
const handlerCache = new Map<string, ReturnType<typeof withMcpAuth>>();

export function getHandler(vaultId: string) {
  if (!handlerCache.has(vaultId)) {
    const mcpHandler = createMcpHandler(
      (server) => registerTools(server),
      {},
      { basePath: `/api/${vaultId}`, maxDuration: 60 },
    );
    handlerCache.set(
      vaultId,
      withMcpAuth(
        mcpHandler,
        async (req: Request, bearerToken?: string) => {
          if (!bearerToken) return undefined;
          const url = new URL(req.url);
          const resourceUrl = `${url.origin}/api/mcp`;
          const authInfo = await verifyMcpToken(bearerToken, resourceUrl);
          if (!authInfo) return undefined;
          return { ...authInfo, extra: { ...(authInfo.extra as object), vaultId } };
        },
        { required: true },
      ),
    );
  }
  return handlerCache.get(vaultId)!;
}
