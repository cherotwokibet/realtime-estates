import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { previewConfiguration, assertPreviewRequest } from './staff-preview-policy.ts';
import { readReferenceJson } from './reference-draft-wire.ts';
import { createPrivateRecoveryCipher } from './private-recovery-cipher.ts';
import {
  captureRecoveryScope,
  recoveryKind,
  recoveryObject,
  sameRecoveryScope,
  RECOVERY_MAX_WIRE_BYTES,
} from './private-recovery-contract.ts';
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
/** Explicit developer adapter. No key generation/fallback, hosted-cookie assumption or write execution. */
export async function privateRecoveryRequest(
  request: Request,
  kindInput: string,
  action: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
) {
  let kind;
  try {
    kind = recoveryKind(kindInput);
    if (action !== 'seal' && action !== 'open' && action !== 'check') throw Error();
  } catch {
    return reply(404, { error: 'RECOVERY_UNAVAILABLE' });
  }
  if (request.method !== 'POST')
    return new Response(null, {
      status: 405,
      headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
    });
  let config, cipher;
  try {
    config = previewConfiguration(env);
    if (env.PRIVATE_RECOVERY_MODE !== 'synthetic-sealed-original-v1') throw Error();
    cipher = createPrivateRecoveryCipher(env.PRIVATE_RECOVERY_STORAGE_KEY ?? '');
  } catch {
    return reply(503, { error: 'RECOVERY_UNAVAILABLE' });
  }
  try {
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, { error: 'RECOVERY_UNAVAILABLE' });
  }
  const url = new URL(request.url);
  if (
    request.url.includes('?') ||
    request.url.includes('#') ||
    [
      'cookie',
      'content-encoding',
      'transfer-encoding',
      'x-actor-id',
      'x-tenant-id',
      'x-role',
      'x-company-id',
      'x-reference-actor',
      'x-reference-tenant',
    ].some((k) => request.headers.has(k))
  )
    return reply(400, { error: 'INVALID_RECOVERY_REQUEST' });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  let upstreamDenied: 401 | 403 | null = null;
  const apiFetch: typeof fetch = async (...args) => {
    const response = await (transport ?? fetch)(...args);
    if (response.status === 401 || response.status === 403) {
      upstreamDenied = response.status;
      void response.body?.cancel().catch(() => {});
      throw new ApiClientError('HTTP', 'Recovery authorization unavailable.', {
        status: response.status,
      });
    }
    return response;
  };
  try {
    const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-private-recovery-v1',
      allowLoopbackHttp: true,
      fetch: apiFetch,
    });
    const options = { bearerToken: config.bearerToken, signal, timeoutMs: 5000 };
    const initial = await client.getCurrentStaffAccessLeaseV2(options);
    if (initial.role !== 'admin') return reply(403, { error: 'RECOVERY_UNAVAILABLE' });
    const input = recoveryObject(
      await readReferenceJson(request, RECOVERY_MAX_WIRE_BYTES, signal),
      action === 'check' ? ['scope'] : ['scope', action === 'seal' ? 'command' : 'envelope'],
    );
    const scope = captureRecoveryScope(input.scope),
      current = await client.getCurrentStaffAccessLeaseV2(options);
    const trusted = {
      instanceId: config.instanceId,
      tenantId: current.tenantId,
      actorId: current.actorId,
    };
    if (
      current.role !== 'admin' ||
      !sameRecoveryScope(scope, trusted) ||
      initial.tenantId !== current.tenantId ||
      initial.actorId !== current.actorId ||
      Date.now() >= Date.parse(current.expiresAt)
    )
      return reply(403, { error: 'RECOVERY_UNAVAILABLE' });
    const value =
      action === 'check'
        ? { policy: 'private-recovery-ready-v1', scope: trusted, kind }
        : action === 'seal'
          ? cipher.seal(trusted, kind, input.command)
          : cipher.open(trusted, kind, input.envelope);
    if (signal.aborted || Date.now() >= Date.parse(current.expiresAt))
      return reply(403, { error: 'RECOVERY_UNAVAILABLE' });
    return reply(200, value);
  } catch (error) {
    return reply(
      upstreamDenied ??
        (error instanceof ApiClientError
          ? [401, 403].includes(error.status ?? 0)
            ? error.status!
            : 503
          : signal.aborted
            ? 408
            : 400),
      { error: 'RECOVERY_UNAVAILABLE' },
    );
  }
}
