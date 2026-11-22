import { validateInvitationRecipientLease, type InvitationRecipientLease } from '@realtor/domain';
import { readReferenceJson } from './reference-draft-wire.ts';
export async function readInvitationRecipientLease(
  instanceId: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<InvitationRecipientLease> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId))
    throw Error('Recipient unavailable.');
  const combined = AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    path = '/api/invitation-acceptance/lease';
  const r = await transport(path, {
    method: 'GET',
    signal: combined,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'X-Preview-Instance': instanceId },
  });
  if (r.status !== 200 || r.redirected) {
    void r.body?.cancel().catch(() => {});
    throw Error('Recipient unavailable.');
  }
  if (r.url) {
    const actual = new URL(r.url);
    if (
      actual.pathname !== path ||
      actual.search ||
      actual.hash ||
      (typeof location !== 'undefined' && actual.origin !== location.origin)
    ) {
      void r.body?.cancel().catch(() => {});
      throw Error('Recipient unavailable.');
    }
  }
  return validateInvitationRecipientLease(await readReferenceJson(r, 4096, combined));
}
