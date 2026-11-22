import 'server-only';
import { previewConfiguration } from './staff-preview-policy.ts';

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

/** Old clients must reload rather than read data without a captured actor fence. */
export async function readPushQueuePreview(_request: Request) {
  return Response.json(
    { error: 'RELOAD_PRIVATE_WORKSPACE' },
    { status: 410, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
