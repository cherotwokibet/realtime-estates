import { staffMembershipCurrentBoundary } from '../../../../../lib/staff-membership-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ member: string }> };
export async function GET(request: Request, context: Context) {
  const { member } = await context.params;
  return staffMembershipCurrentBoundary(request, member);
}
