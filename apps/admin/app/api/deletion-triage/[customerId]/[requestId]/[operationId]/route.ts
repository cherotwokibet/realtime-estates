import { deletionTriageBoundary } from '../../../../../../lib/deletion-triage-server.ts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ customerId: string; requestId: string; operationId: string }> };
const handle = async (request: Request, context: Context) =>
  deletionTriageBoundary(request, await context.params);
export const GET = handle;
export const POST = handle;
