import { companySettingsBoundary } from '../../../../../lib/company-settings-server.ts';
type Context = { params: Promise<{ id: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return companySettingsBoundary(request, (await context.params).id);
}
export async function POST(request: Request, context: Context) {
  return companySettingsBoundary(request, (await context.params).id);
}
