import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  validateCustomerDeletionReviewCommand,
  validateDeletionPrivacyCommand,
  type DeletionPrivacyCommand,
  validateCustomerDeletionReviewTarget,
  type CustomerDeletionReviewTarget,
  type CustomerDeletionDisposition,
  type CustomerDeletionReviewCommand,
} from '@realtor/domain';
import { readReferenceJson } from './reference-draft-wire.ts';
import {
  assertPreviewRequest,
  previewConfiguration,
  upstreamFailureStatus,
} from './staff-preview-policy.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function deletionTriageConfiguration(env: Readonly<Record<string, string | undefined>>) {
  const config = previewConfiguration(env);
  const tenantId = env.STAFF_DELETION_TRIAGE_TENANT;
  const reviewerId = env.STAFF_DELETION_TRIAGE_REVIEWER;
  if (
    env.STAFF_DELETION_TRIAGE_MODE !== 'synthetic-v1' ||
    !tenantId ||
    !reviewerId ||
    !uuid.test(tenantId) ||
    !uuid.test(reviewerId)
  )
    throw Error('Deletion triage preview is unavailable.');
  return {
    ...config,
    scope: { tenantId, reviewerId },
    followUp: env.STAFF_DELETION_FOLLOW_UP === 'synthetic-v1',
  };
}

export function deletionPrivacyConfiguration(env: Readonly<Record<string, string | undefined>>) {
  const config = previewConfiguration({
    ...env,
    STAFF_PREVIEW_TOKEN: env.STAFF_DELETION_PRIVACY_TOKEN,
  });
  const tenantId = env.STAFF_DELETION_TRIAGE_TENANT;
  const reviewerId = env.STAFF_DELETION_PRIVACY_REVIEWER;
  if (
    env.STAFF_DELETION_PRIVACY_MODE !== 'synthetic-v1' ||
    !tenantId ||
    !reviewerId ||
    !uuid.test(tenantId) ||
    !uuid.test(reviewerId)
  )
    throw Error('Deletion privacy preview is unavailable.');
  return {
    ...config,
    scope: { tenantId, reviewerId },
    processingPlan: env.STAFF_DELETION_PROCESSING_PLAN === 'synthetic-v1',
  };
}

const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

export async function deletionTriageBoundary(
  request: Request,
  operation?: CustomerDeletionReviewTarget,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
  action: 'triage' | 'return' | 'privacy' | 'processing-plan' = 'triage',
) {
  const privacyAction = action === 'privacy' || action === 'processing-plan';
  let config: ReturnType<typeof deletionTriageConfiguration> & { processingPlan?: boolean };
  try {
    config = privacyAction
      ? { ...deletionPrivacyConfiguration(env), followUp: false }
      : deletionTriageConfiguration(env);
    assertPreviewRequest(request, config.instanceId);
    request.headers.forEach((_value, name) => {
      if (
        (name.startsWith('x-') &&
          name !== 'x-preview-instance' &&
          ![
            'x-forwarded-host',
            'x-forwarded-port',
            'x-forwarded-proto',
            'x-forwarded-for',
          ].includes(name)) ||
        name.startsWith('if-') ||
        ['cookie', 'range', 'idempotency-key', 'content-encoding'].includes(name)
      )
        throw Error();
    });
  } catch {
    return reply(403, { error: 'TRIAGE_UNAVAILABLE' });
  }
  if (action === 'return' && (!operation || !config.followUp))
    return reply(404, { error: 'TRIAGE_UNAVAILABLE' });
  if (action === 'processing-plan' && (!operation || !config.processingPlan))
    return reply(404, { error: 'TRIAGE_UNAVAILABLE' });
  if (
    request.method !== 'GET' &&
    !(operation && action !== 'processing-plan' && request.method === 'POST')
  )
    return reply(405, { error: 'METHOD_UNAVAILABLE' });
  if (
    request.url.includes('#') ||
    (operation && request.url.includes('?')) ||
    (request.method === 'GET' &&
      (request.body !== null ||
        request.headers.has('content-type') ||
        request.headers.has('content-length')))
  )
    return reply(400, { error: 'INVALID_TRIAGE_REQUEST' });

  const api = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
    fetch: fetcher,
    timeoutMs: 10000,
  });
  const options = { bearerToken: config.bearerToken, signal: request.signal };
  let command: CustomerDeletionReviewCommand | undefined;
  let privacyCommand: DeletionPrivacyCommand | undefined;
  let submittedReturn = false;
  try {
    if (!operation) {
      const query = new URL(request.url).searchParams;
      const filters: { limit?: number; after?: string } = {};
      let outcome: CustomerDeletionDisposition | undefined;
      for (const [key, value] of query) {
        if (key === 'limit' && filters.limit === undefined && /^[1-9]\d?$/.test(value))
          filters.limit = Number(value);
        else if (key === 'after' && filters.after === undefined && uuid.test(value))
          filters.after = value;
        else if (
          action !== 'privacy' &&
          key === 'disposition' &&
          outcome === undefined &&
          (value === 'ready_for_privacy_review' || value === 'needs_information')
        )
          outcome = value;
        else return reply(400, { error: 'INVALID_TRIAGE_REQUEST' });
      }
      if (action === 'privacy')
        return reply(200, await api.listDeletionPrivacyQueue(filters, config.scope, options));
      if (outcome) {
        if (!config.followUp) return reply(404, { error: 'TRIAGE_UNAVAILABLE' });
        return reply(
          200,
          await api.listCustomerDeletionFollowUp(outcome, filters, config.scope.tenantId, options),
        );
      }
      return reply(
        200,
        await api.listCustomerDeletionTriage(filters, config.scope.tenantId, options),
      );
    }
    let target: CustomerDeletionReviewTarget;
    try {
      target = validateCustomerDeletionReviewTarget(operation);
      if (request.method === 'POST') {
        const input = await readReferenceJson(
          request,
          2048,
          AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        );
        if (action === 'privacy') privacyCommand = validateDeletionPrivacyCommand(input);
        if (action === 'triage') command = validateCustomerDeletionReviewCommand(input);
        const submitted = command ?? privacyCommand ?? validateCustomerDeletionReviewTarget(input);
        if (
          submitted.customerId !== target.customerId ||
          submitted.requestId !== target.requestId ||
          submitted.operationId !== target.operationId
        )
          throw Error();
        submittedReturn = action === 'return';
      }
    } catch {
      return reply(400, { error: 'INVALID_TRIAGE_REQUEST' });
    }
    if (action === 'processing-plan')
      return reply(200, await api.getDeletionProcessingPlan(target, config.scope, options));
    if (action === 'privacy') {
      const receipt = privacyCommand
        ? await api.recordDeletionPrivacyDecision(privacyCommand, config.scope, options)
        : await api.getDeletionPrivacyDecision(target, config.scope, options);
      return reply(200, receipt);
    }
    if (action === 'return') {
      const receipt = submittedReturn
        ? await api.returnCustomerDeletionToReview(target, config.scope, options)
        : await api.getCustomerDeletionReviewReturn(target, config.scope, options);
      return reply(200, receipt);
    }
    const receipt = command
      ? await api.reviewCustomerDeletion(command, config.scope, options)
      : await api.getCustomerDeletionReview(target, config.scope, options);
    return reply(200, receipt);
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 502,
      {
        error: 'TRIAGE_UNAVAILABLE',
        submissionUncertain:
          (!!command || !!privacyCommand || submittedReturn) &&
          (!(error instanceof ApiClientError) || error.submissionUncertain),
      },
    );
  }
}
