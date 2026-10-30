import { listingReportsBoundary } from '../../../lib/listing-reports-server.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return listingReportsBoundary(request);
}
