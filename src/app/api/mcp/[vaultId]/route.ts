import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';
import { validateVaultId } from '@/lib/vault/storage/index';

type Params = { params: Promise<{ vaultId: string }> };

// Cache one handler per vaultId — preserves in-memory Streamable HTTP session state.
const handlerCache = new Map<string, ReturnType<typeof withMcpAuth>>();

function getHandler(vaultId: string) {
  if (!handlerCache.has(vaultId)) {
    const mcpHandler = createMcpHandler(
      (server) => registerTools(server),
      {},
      { streamableHttpEndpoint: `/api/mcp/${vaultId}`, maxDuration: 60 },
    );
    handlerCache.set(
      vaultId,
      withMcpAuth(
        mcpHandler,
        async (req: Request, bearerToken?: string) => {
          if (!bearerToken) return undefined;
          const url = new URL(req.url);
          // Tokens are issued with /api/mcp as the audience regardless of vault path.
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

async function handle(req: Request, { params }: Params) {
  const { vaultId } = await params;
  validateVaultId(vaultId);
  return getHandler(vaultId)(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
