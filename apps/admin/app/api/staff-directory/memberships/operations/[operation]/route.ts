import { staffMembershipOperationBoundary } from '../../../../../../lib/staff-membership-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ operation: string }> };
export async function GET(request: Request, context: Context) {
  const { operation } = await context.params;
  return staffMembershipOperationBoundary(request, operation);
}
export async function POST(request: Request, context: Context) {
  const { operation } = await context.params;
  return staffMembershipOperationBoundary(request, operation);
}
