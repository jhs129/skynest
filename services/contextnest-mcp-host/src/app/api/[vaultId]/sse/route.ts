import { validateVaultId } from '@/lib/vault/storage/index';
import { getHandler } from '../_handler';

type Params = { params: Promise<{ vaultId: string }> };

async function handle(req: Request, { params }: Params) {
  const { vaultId } = await params;
  validateVaultId(vaultId);
  return getHandler(vaultId)(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
