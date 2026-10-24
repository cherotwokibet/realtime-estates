import 'server-only';
import { readStaffAllocationScope } from './staff-allocation-scope.ts';
import { previewConfiguration, assertPreviewRequest } from './staff-preview-policy.ts';
import { listingCreationPreviewRequest } from './listing-creation-server.ts';
import { listingSuccessorPreviewRequest } from './listing-successor-server.ts';
const reply = (status: number) =>
  Response.json(
    { error: { code: 'ALLOCATION_SCOPE_UNAVAILABLE' }, submissionUncertain: false },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
/** Exact retained route. Browser IDs only detect stale scope; never select server authority. */
export async function retainedAllocationRequest(
  request: Request,
  params: { id: string; operationId: string },
  kind: 'creation' | 'revision',
) {
  try {
    const environment = { ...process.env },
      config = previewConfiguration(environment);
    assertPreviewRequest(request, config.instanceId);
    const url = new URL(request.url),
      path = `/api/staff/listings/${params.id}/retained-${kind}-operations/${params.operationId}`;
    if (
      !new RegExp(`^${uuid}$`).test(params.id) ||
      !new RegExp(`^${uuid}$`).test(params.operationId) ||
      url.pathname !== path
    )
      return reply(404);
    if (!['GET', 'POST'].includes(request.method)) return reply(405);
    if (request.url.includes('?') || request.url.includes('#')) return reply(400);
    let forbidden = false;
    request.headers.forEach((_, name) => {
      if (
        [
          'authorization',
          'cookie',
          'content-encoding',
          'transfer-encoding',
          'expect',
          'range',
          'idempotency-key',
          'x-actor-id',
          'x-tenant-id',
          'x-role',
          'x-actor',
          'x-tenant',
          'x-company-id',
          'x-assigned-agent-id',
          'x-revision-version',
        ].includes(name) ||
        name.startsWith('if-')
      )
        forbidden = true;
    });
    if (
      forbidden ||
      (request.headers.has('origin') &&
        request.headers.get('origin') !== `http://${request.headers.get('host')}`)
    )
      return reply(400);
    const actor = request.headers.get('x-allocation-actor'),
      tenant = request.headers.get('x-allocation-tenant');
    if (
      !actor ||
      !tenant ||
      !new RegExp(`^${uuid}$`).test(actor) ||
      !new RegExp(`^${uuid}$`).test(tenant)
    )
      return reply(400);
    if (
      request.method === 'GET' &&
      (request.body !== null ||
        request.headers.has('content-type') ||
        request.headers.has('content-length'))
    )
      return reply(400);
    const current = await readStaffAllocationScope(environment);
    if (request.signal.aborted) return reply(400);
    if (
      current.instanceId !== config.instanceId ||
      current.actorId !== actor ||
      current.tenantId !== tenant
    )
      return reply(409);
    // The delegated handler independently applies the ordinary strict body, route and API guards.
    return kind === 'creation'
      ? await listingCreationPreviewRequest(request, params, config)
      : await listingSuccessorPreviewRequest(request, params, config);
  } catch {
    return reply(403);
  }
}
