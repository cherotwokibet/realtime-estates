import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  assertPreviewRequest,
  previewConfiguration,
  upstreamFailureStatus,
} from './staff-preview-policy.ts';

export function pushQueueConfiguration(env: Readonly<Record<string, string | undefined>>) {
  const config = previewConfiguration(env);
  const tenantId = env.STAFF_PUSH_QUEUE_TENANT;
  if (
    env.STAFF_PUSH_QUEUE_MODE !== 'synthetic-v1' ||
    !tenantId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId)
  )
    throw Error('Notification queue preview is unavailable.');
  return { ...config, tenantId };
}

const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

export async function readPushQueuePreview(request: Request) {
  let config: ReturnType<typeof pushQueueConfiguration>;
  try {
    config = pushQueueConfiguration(process.env);
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, { error: 'QUEUE_UNAVAILABLE' });
  }
  if (request.method !== 'GET') return reply(405, { error: 'METHOD_UNAVAILABLE' });
  if (request.url.includes('?') || request.url.includes('#') || request.body !== null)
    return reply(400, { error: 'INVALID_REQUEST' });

  try {
    const api = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      allowLoopbackHttp: true,
      timeoutMs: 10000,
    });
    return reply(
      200,
      await api.getSyntheticPushQueueSummary(config.tenantId, {
        bearerToken: config.bearerToken,
        signal: request.signal,
      }),
    );
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 502,
      { error: 'QUEUE_UNAVAILABLE' },
    );
  }
}
