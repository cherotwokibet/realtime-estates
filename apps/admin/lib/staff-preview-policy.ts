/** A loopback-only synthetic developer adapter. This is deliberately unavailable in production. */
export function upstreamFailureStatus(status: number | undefined, kind: string): number {
  return status !== undefined && status >= 400 && status <= 599
    ? status
    : kind === 'VALIDATION'
      ? 400
      : 502;
}
export function previewConfiguration(env: Readonly<Record<string, string | undefined>>) {
  if (env.NODE_ENV !== 'development' || env.STAFF_PREVIEW_MODE !== 'synthetic')
    throw new Error('Staff preview is not enabled.');
  const origin = new URL(env.STAFF_PREVIEW_API_ORIGIN ?? '');
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error('Invalid preview origin.');
  const bearerToken = env.STAFF_PREVIEW_TOKEN;
  if (
    !bearerToken ||
    bearerToken.length > 8192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearerToken)
  )
    throw new Error('Preview identity is unavailable.');
  const instanceId = env.STAFF_PREVIEW_INSTANCE;
  if (!instanceId || !/^[a-f0-9-]{36}$/.test(instanceId))
    throw new Error('Preview instance is unavailable.');
  return { origin: origin.origin, bearerToken, instanceId };
}
export function assertPreviewRequest(
  request: Request,
  instanceId: string,
  bodyType: 'json' | 'binary' | 'empty' = 'json',
): void {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (request.headers.get('x-preview-instance') !== instanceId)
    throw new Error('Reload after restarting the preview.');
  // Next's Node adapter can use localhost internally while retaining the incoming 127.0.0.1 Host.
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    host !== `127.0.0.1${url.port ? `:${url.port}` : ''}` ||
    request.headers.has('authorization')
  )
    throw new Error('Preview requires its exact loopback Host.');
  if (
    request.method !== 'GET' &&
    (request.headers.get('origin') !== `http://${host}` ||
      (bodyType === 'empty'
        ? request.headers.has('content-type')
        : request.headers.get('content-type')?.split(';')[0] !==
          (bodyType === 'binary' ? 'application/octet-stream' : 'application/json')))
  )
    throw new Error('A same-origin request with the expected body type is required.');
  // Next may represent an empty POST as an empty stream. The command handler
  // must verify those bytes; headers alone do not establish an empty body.
  if (
    bodyType === 'empty' &&
    (request.headers.has('transfer-encoding') ||
      !['0', null].includes(request.headers.get('content-length')))
  )
    throw new Error('An empty command is required.');
  if (
    request.headers.get('sec-fetch-site') &&
    !['same-origin', 'none'].includes(request.headers.get('sec-fetch-site')!)
  )
    throw new Error('Cross-origin requests are unavailable.');
}
