import 'server-only';
import {
  parseCompanySettingsJson,
  validateCompanySettingsCommand,
  validateCompanySettingsRecord,
  validateCompanySettingsState,
} from '@realtor/domain';
import { previewConfiguration, assertPreviewRequest } from './staff-preview-policy.ts';
type Env = Readonly<Record<string, string | undefined>>;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Twenty maximum-length Unicode records fit this bound; never assume ASCII byte widths.
const MAX = 512 * 1024;
async function boundedBody(response: Response | Request, maximum: number) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty settings response.');
  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 10_000);
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (expired) throw Error('Settings body deadline exceeded.');
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw Error('Settings body too large.');
      chunks.push(value);
    }
  } finally {
    clearTimeout(deadline);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function transport(
  env: Env,
  operationId: string | null,
  command: unknown,
  signal?: AbortSignal,
) {
  const config = previewConfiguration(env);
  if (operationId !== null && !ID.test(operationId)) throw Error('Invalid original operation.');
  const url =
    config.origin +
    '/v2/staff/company-settings' +
    (operationId ? '/operations/' + operationId : '');
  const abort = AbortSignal.timeout(10_000);
  const response = await fetch(url, {
    method: command === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + config.bearerToken,
      Accept: 'application/json',
      ...(command === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(command === undefined ? {} : { body: JSON.stringify(command) }),
    cache: 'no-store',
    redirect: 'error',
    credentials: 'omit',
    signal: signal ? AbortSignal.any([signal, abort]) : abort,
  });
  if (!response.ok) {
    await response.body?.cancel();
    return {
      ok: false as const,
      status: [400, 401, 403, 404, 409, 422, 429].includes(response.status) ? response.status : 502,
    };
  }
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    await response.body?.cancel();
    throw Error('Invalid settings response.');
  }
  const json = JSON.parse(await boundedBody(response, MAX));
  const data = operationId
    ? validateCompanySettingsRecord(json)
    : validateCompanySettingsState(json);
  if (
    operationId &&
    'operationId' in data &&
    (data.operationId !== operationId ||
      (command && JSON.stringify(data.request) !== JSON.stringify(command)))
  )
    throw Error('Original settings response changed request.');
  return { ok: true as const, data };
}
export async function loadCompanySettings(env: Env = process.env) {
  const config = previewConfiguration(env);
  const result = await transport(env, null, undefined);
  if (!result.ok) throw Error('Current admin read required.');
  return { state: validateCompanySettingsState(result.data), instanceId: config.instanceId };
}
/** Development BFF only: fixed server scope, fresh API authority; no browser bearer/provider credentials. */
export async function companySettingsBoundary(
  request: Request,
  operationId: string | null = null,
  env: Env = process.env,
) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
  try {
    let config: ReturnType<typeof previewConfiguration>;
    try {
      config = previewConfiguration(env);
    } catch {
      return reply(403, { error: 'PREVIEW_UNAVAILABLE' });
    }
    const url = new URL(request.url);
    if (url.search || url.hash || (operationId !== null && !ID.test(operationId)))
      return reply(400, { error: 'INVALID_INPUT' });
    const expected = '/api/company-settings' + (operationId ? '/operations/' + operationId : '');
    if (
      url.pathname !== expected ||
      !['GET', 'POST'].includes(request.method) ||
      (request.method === 'POST' && operationId === null)
    )
      return reply(405, { error: 'METHOD_NOT_ALLOWED' });
    try {
      assertPreviewRequest(request, config.instanceId, request.method === 'GET' ? 'empty' : 'json');
    } catch {
      return reply(403, { error: 'PREVIEW_UNAVAILABLE' });
    }
    if (
      request.headers.has('cookie') ||
      request.headers.has('x-company-id') ||
      request.headers.has('x-actor-id') ||
      request.headers.has('x-role') ||
      request.headers.has('x-tenant-id') ||
      (request.method === 'GET' && (request.body !== null || request.headers.has('content-type')))
    )
      return reply(400, { error: 'INVALID_INPUT' });
    let command: unknown = undefined;
    if (request.method === 'POST') {
      try {
        command = validateCompanySettingsCommand(
          parseCompanySettingsJson(await boundedBody(request, 32 * 1024)),
        );
      } catch {
        return reply(400, { error: 'INVALID_INPUT' });
      }
      if ((command as { operationId: string }).operationId !== operationId)
        return reply(400, { error: 'INVALID_INPUT' });
    }
    const result = await transport(env, operationId, command, request.signal);
    return result.ok
      ? reply(200, result.data)
      : reply(result.status, {
          error:
            result.status === 409
              ? 'VERSION_OR_ORIGINAL_CONFLICT'
              : result.status === 403 || result.status === 401
                ? 'ACCESS_ENDED'
                : result.status === 404
                  ? 'ORIGINAL_UNAVAILABLE'
                  : 'SETTINGS_UNAVAILABLE',
        });
  } catch {
    return reply(502, {
      error: request.method === 'POST' ? 'RESULT_UNCERTAIN' : 'SETTINGS_UNAVAILABLE',
    });
  }
}
