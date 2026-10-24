import { retainedAllocationRequest } from '../../../../../../../lib/retained-allocation-server.ts';
type Context = { params: Promise<{ id: string; operationId: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return retainedAllocationRequest(request, await context.params, 'creation');
}
export async function POST(request: Request, context: Context) {
  return retainedAllocationRequest(request, await context.params, 'creation');
}
