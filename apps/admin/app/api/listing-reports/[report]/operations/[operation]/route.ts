import { listingReportDecisionBoundary } from '../../../../../../lib/listing-reports-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ report: string; operation: string }> };
async function handle(request: Request, context: Context) {
  const { report, operation } = await context.params;
  return listingReportDecisionBoundary(request, report, operation);
}
export const GET = handle;
export const POST = handle;
