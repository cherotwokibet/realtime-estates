import { staffBranchBoundary } from '../../../../../lib/staff-branch-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ branch: string }> };
export async function GET(request: Request, context: Context) {
  const params = await context.params;
  return staffBranchBoundary(request, 'current', params.branch);
}
