import {
  validateAdminAuditPage,
  validateAdminAuditQuery,
  validateSyntheticPushQueueSummary,
  type AdminAuditQuery,
} from '@realtor/domain';
import {
  captureRecoveryScope,
  recoveryObject,
  sameRecoveryScope,
  type RecoveryScope,
} from './private-recovery-contract.ts';
import { readBrowserDecodedJson } from './browser-decoded-json.ts';

export async function readPrivateSummary(
  input: RecoveryScope,
  kind: 'audit' | 'push',
  signal: AbortSignal,
  query?: AdminAuditQuery,
  transport: typeof fetch = fetch,
) {
  const scope = captureRecoveryScope(input);
  const filters = validateAdminAuditQuery(
    query ?? { limit: 20, before: null, actorId: null, objectId: null },
  );
  const params = new URLSearchParams({ limit: String(filters.limit) });
  for (const key of ['before', 'actorId', 'objectId'] as const)
    if (filters[key] !== null) params.set(key, filters[key]);
  const path = '/api/private-summary/' + kind + (kind === 'audit' ? '?' + params : '');
  const combined = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  if (combined.aborted) throw Error('Private read cancelled.');
  const response = await transport(path, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: combined,
    headers: {
      'X-Preview-Instance': scope.instanceId,
      'X-Preview-Tenant': scope.tenantId,
      'X-Preview-Actor': scope.actorId,
    },
  });
  if (response.status !== 200 || response.redirected) {
    void response.body?.cancel().catch(() => {});
    throw Object.assign(Error('Private read unavailable.'), { status: response.status });
  }
  if (response.url) {
    const url = new URL(response.url);
    if (
      url.pathname + url.search !== path ||
      url.hash ||
      url.username ||
      url.password ||
      (typeof location !== 'undefined' && url.origin !== location.origin)
    ) {
      void response.body?.cancel().catch(() => {});
      throw Error('Private read target changed.');
    }
  }
  const result = recoveryObject(await readBrowserDecodedJson(response, 131072, combined), [
    'policy',
    'kind',
    'scope',
    'data',
  ]);
  if (
    combined.aborted ||
    result.policy !== 'private-summary-v1' ||
    result.kind !== kind ||
    !sameRecoveryScope(scope, captureRecoveryScope(result.scope))
  )
    throw Error('Private read scope changed.');
  return kind === 'audit'
    ? validateAdminAuditPage(result.data, scope.tenantId, filters)
    : validateSyntheticPushQueueSummary(result.data, scope.tenantId);
}
