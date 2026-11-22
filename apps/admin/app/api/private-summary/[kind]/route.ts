import { privateSummaryRequest } from '../../../../lib/private-summary-server.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  return privateSummaryRequest(request, (await context.params).kind);
}
