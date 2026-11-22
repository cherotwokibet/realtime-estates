import 'server-only';
import {
  ApiClientError,
  RealtorApiClient,
  validateStaffCaptureCommand,
  validateStaffCaptureReceipt,
} from '@realtor/api-client';
import { enquiryAccessLeaseConfiguration } from './enquiry-preview-server.ts';
import { assertPreviewRequest } from './staff-preview-policy.ts';
import { readReferenceJson } from './reference-draft-wire.ts';
import { recoveryId } from './private-recovery-contract.ts';
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
export async function readStaffCaptureScope(
  actor: 'admin' | 'agent',
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: typeof fetch = fetch,
) {
  const config = enquiryAccessLeaseConfiguration(actor, env),
    api = new RealtorApiClient({
      baseUrl: config.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      fetch: transport,
    });
  const lease = await api.getCurrentStaffAccessLeaseV2({
    bearerToken: config.bearerToken,
    timeoutMs: 5000,
  });
  if (
    lease.role !== actor ||
    lease.actorId !== config.actorId ||
    Date.now() >= Date.parse(lease.expiresAt)
  )
    throw Error('Capture access unavailable.');
  return { instanceId: config.instanceId, tenantId: lease.tenantId, actorId: lease.actorId };
}
export async function staffCaptureOriginalRequest(
  request: Request,
  actor: string,
  operationInput: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: typeof fetch = fetch,
) {
  if (actor !== 'admin' && actor !== 'agent') return reply(404, { error: 'CAPTURE_UNAVAILABLE' });
  let config;
  try {
    config = enquiryAccessLeaseConfiguration(actor, env);
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, { error: 'CAPTURE_UNAVAILABLE' });
  }
  if (!['GET', 'POST'].includes(request.method)) return reply(405, { error: 'METHOD_UNAVAILABLE' });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  let op, command;
  try {
    op = recoveryId(operationInput);
    if (
      request.url.includes('?') ||
      request.url.includes('#') ||
      [
        'cookie',
        'range',
        'content-encoding',
        'transfer-encoding',
        'idempotency-key',
        'x-actor-id',
        'x-tenant-id',
        'x-role',
      ].some((k) => request.headers.has(k)) ||
      (request.method === 'GET' &&
        (request.body !== null ||
          request.headers.has('content-type') ||
          request.headers.has('content-length')))
    )
      throw Error();
    if (request.method === 'POST') {
      command = validateStaffCaptureCommand(await readReferenceJson(request, 16384, signal));
      if (command.role !== actor || command.operationId !== op) throw Error();
    }
  } catch {
    return reply(400, { error: 'INVALID_CAPTURE_ORIGINAL' });
  }
  let denied: number | undefined;
  const api = new RealtorApiClient({
    baseUrl: config.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    fetch: async (...args) => {
      const r = await transport(...args);
      if ([401, 403].includes(r.status)) {
        denied = r.status;
        void r.body?.cancel().catch(() => {});
        throw new ApiClientError('HTTP', 'Capture access denied.', { status: r.status });
      }
      return r;
    },
  });
  const options = { bearerToken: config.bearerToken, signal, timeoutMs: 10000 };
  try {
    const initial = await api.getCurrentStaffAccessLeaseV2(options);
    if (
      initial.role !== actor ||
      initial.actorId !== config.actorId ||
      Date.now() >= Date.parse(initial.expiresAt)
    )
      return reply(403, { error: 'CAPTURE_UNAVAILABLE' });
    // GET uses only the operation ID. Full request comparison occurs on the browser's retained original.
    const value = command
      ? await api.staffCaptureOriginal(command, options)
      : await api.readStaffCaptureOriginal(op, options);
    const receipt = validateStaffCaptureReceipt(value, command ?? value.request, {
      tenantId: initial.tenantId,
      actorId: initial.actorId,
    });
    const current = await api.getCurrentStaffAccessLeaseV2(options);
    if (
      signal.aborted ||
      current.role !== actor ||
      current.actorId !== initial.actorId ||
      current.tenantId !== initial.tenantId ||
      Date.now() >= Date.parse(initial.expiresAt) ||
      Date.now() >= Date.parse(current.expiresAt)
    )
      return reply(403, { error: 'CAPTURE_UNAVAILABLE' });
    return reply(200, receipt);
  } catch (error) {
    return reply(
      denied ??
        (error instanceof ApiClientError && [401, 403, 404, 409].includes(error.status ?? 0)
          ? error.status!
          : 503),
      { error: 'CAPTURE_UNAVAILABLE' },
    );
  }
}
