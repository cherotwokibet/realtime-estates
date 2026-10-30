import { staffDirectoryBoundary } from '../../../../lib/staff-directory-server.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return staffDirectoryBoundary(request, 'invitations');
}
