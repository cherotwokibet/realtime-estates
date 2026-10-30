import { handleListingReport } from '../../../../../lib/listing-report-server';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ listing: string; operation: string }> };
async function handle(request: Request, context: Context) {
  const { listing, operation } = await context.params;
  return handleListingReport(request, listing, operation);
}
export const GET = handle;
export const POST = handle;
