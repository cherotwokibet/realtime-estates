import { privateRecoveryRequest } from '../../../../../../lib/private-recovery-server.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string; action: string }> },
) {
  const { kind, action } = await params;
  return privateRecoveryRequest(request, kind, action);
}
