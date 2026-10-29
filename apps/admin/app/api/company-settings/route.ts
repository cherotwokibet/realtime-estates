import { companySettingsBoundary } from '../../../lib/company-settings-server.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return companySettingsBoundary(request);
}
