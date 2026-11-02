import { staffMembershipDirectoryBoundary } from '../../../../lib/staff-membership-server.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return staffMembershipDirectoryBoundary(request);
}
