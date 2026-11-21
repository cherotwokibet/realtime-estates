import { privateWorkspaceLeaseRequest } from '../../../../../lib/private-workspace-lease-server.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ profile: string }> }) {
  return privateWorkspaceLeaseRequest(request, (await params).profile);
}
