import { deletionTriageBoundary } from '../../../../../../../lib/deletion-triage-server.ts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ customerId: string; requestId: string; operationId: string }> };
export const GET = async (request: Request, context: Context) =>
  deletionTriageBoundary(request, await context.params, process.env, fetch, 'processing-plan');
