import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import type { SyntheticReferenceContext } from '@realtor/domain';
import type { ReferenceModerationScope } from './reference-moderation-client.ts';
import { previewConfiguration } from './staff-preview-policy.ts';

export interface ReferenceModerationScreen {
  readonly scope: ReferenceModerationScope;
  readonly context: SyntheticReferenceContext | null;
}
/** Default-off server loader. Only the API's current session and stored snapshot supply scope and catalogue. */
export async function readReferenceModerationScreen(
  listingId: string,
  revision: string,
  expectedVersion: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
): Promise<ReferenceModerationScreen> {
  const config = previewConfiguration(env);
  if (
    env.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1' ||
    env.STAFF_PREVIEW_REFERENCE_MODERATION !== 'synthetic-reference-transition-v1' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(listingId) ||
    !/^[1-9]\d{0,9}$/.test(revision) ||
    BigInt(revision) > 2147483647n ||
    !/^[1-9]\d{0,15}$/.test(expectedVersion) ||
    BigInt(expectedVersion) > 9007199254740991n
  )
    throw Error('Reference review unavailable.');
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const options = { bearerToken: config.bearerToken, timeoutMs: 10000 };
  const current = await client.getSyntheticReferenceSessionV3(options);
  let context: SyntheticReferenceContext | null;
  try {
    context = await client.getSyntheticReferenceReviewContextV3(
      listingId,
      Number(revision),
      expectedVersion,
      options,
    );
  } catch (error) {
    // A committed original can remove the pending row. Keep a scoped recovery shell,
    // but never turn malformed, denied or failed reads into a fresh decision workspace.
    if (
      !(error instanceof ApiClientError) ||
      error.kind !== 'HTTP' ||
      ![404, 409].includes(error.status ?? 0)
    )
      throw error;
    context = null;
  }
  return Object.freeze({
    scope: Object.freeze({
      instanceId: config.instanceId,
      tenantId: current.tenantId,
      actorId: current.actorId,
      listingId,
      revision: Number(revision),
    }),
    context,
  });
}
