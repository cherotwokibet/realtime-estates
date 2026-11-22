import { validateStaffAccessLease, type StaffAccessLease } from '@realtor/domain';
import { readBrowserDecodedJson } from './browser-decoded-json.ts';
export interface PrivateWorkspaceAccess {
  readonly profile: 'staff' | 'admin' | 'agent' | 'deletion-triage' | 'deletion-privacy';
  readonly instanceId: string;
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly role?: 'admin' | 'agent';
}
export async function readPrivateWorkspaceLease(
  access: PrivateWorkspaceAccess,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<StaffAccessLease> {
  if (
    !['staff', 'admin', 'agent', 'deletion-triage', 'deletion-privacy'].includes(access.profile) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      access.instanceId,
    )
  )
    throw Error('Private access unavailable.');
  const combined = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  const response = await transport('/api/private-workspace/lease/' + access.profile, {
    method: 'GET',
    signal: combined,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'X-Preview-Instance': access.instanceId },
  });
  if (response.status !== 200 || response.redirected) {
    void response.body?.cancel().catch(() => {});
    throw Error('Private access unavailable.');
  }
  if (response.url) {
    const actual = new URL(response.url);
    if (
      actual.pathname !== '/api/private-workspace/lease/' + access.profile ||
      actual.search ||
      actual.hash ||
      (typeof location !== 'undefined' && actual.origin !== location.origin)
    ) {
      void response.body?.cancel().catch(() => {});
      throw Error('Private access unavailable.');
    }
  }
  return validateStaffAccessLease(await readBrowserDecodedJson(response, 4096, combined));
}
