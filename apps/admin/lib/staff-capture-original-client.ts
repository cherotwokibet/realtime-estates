import {
  validateStaffCaptureCommand,
  validateStaffCaptureReceipt,
  type StaffCaptureCommand,
} from '@realtor/api-client';
import { readBrowserDecodedJson } from './browser-decoded-json.ts';
import { captureRecoveryScope, type RecoveryScope } from './private-recovery-contract.ts';
export async function exchangeStaffCaptureOriginal(
  scopeInput: RecoveryScope,
  input: StaffCaptureCommand,
  recover: boolean,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const scope = captureRecoveryScope(scopeInput),
    command = validateStaffCaptureCommand(input),
    path = '/api/enquiry-preview/' + command.role + '/capture-originals/' + command.operationId;
  if (signal.aborted) throw Error('Capture cancelled.');
  const response = await transport(path, {
    method: recover ? 'GET' : 'POST',
    headers: {
      'X-Preview-Instance': scope.instanceId,
      ...(!recover ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(recover ? {} : { body: JSON.stringify(command) }),
    signal,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status !== 200 || response.redirected) {
    void response.body?.cancel().catch(() => {});
    throw Object.assign(Error('Capture outcome unavailable.'), { status: response.status });
  }
  if (response.url) {
    const url = new URL(response.url);
    if (
      url.pathname !== path ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      (typeof location !== 'undefined' && url.origin !== location.origin)
    ) {
      void response.body?.cancel().catch(() => {});
      throw Error('Capture target changed.');
    }
  }
  return validateStaffCaptureReceipt(
    await readBrowserDecodedJson(response, 16384, signal),
    command,
    scope,
  );
}
