import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  assertPreviewRequest,
  previewConfiguration,
  upstreamFailureStatus,
} from './staff-preview-policy';

const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function decisionBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        throw new Error('Body too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    Object.keys(value).some((key) => !['expectedVersion', 'decision', 'reason'].includes(key))
  )
    throw new Error('Invalid decision envelope.');
  return value as Record<string, unknown>;
}
export async function reviewPreviewRequest(
  request: Request,
  params?: { id: string; revision: string },
  decision = false,
): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, {
      error: {
        code: 'PREVIEW_UNAVAILABLE',
        message:
          'Use the synthetic moderator launcher. Production staff sign-in is not configured.',
      },
    });
  }
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
  });
  const options = { bearerToken: config.bearerToken };
  try {
    if (!params) return reply(200, await client.listReviewsV2({ ...options, limit: 100 }));
    if (!/^[1-9]\d*$/.test(params.revision)) throw new Error('Invalid revision.');
    const revision = Number(params.revision);
    if (!decision) return reply(200, await client.getReviewV2(params.id, revision, options));
    const value = await decisionBody(request);
    if (
      typeof value.expectedVersion !== 'string' ||
      (value.decision !== 'approve' && value.decision !== 'reject') ||
      (value.reason !== null && typeof value.reason !== 'string')
    )
      throw new Error('Invalid decision.');
    return reply(
      200,
      await client.decideReviewV2(
        params.id,
        revision,
        { expectedVersion: value.expectedVersion, decision: value.decision, reason: value.reason },
        options,
      ),
    );
  } catch (error) {
    if (error instanceof ApiClientError)
      return reply(upstreamFailureStatus(error.status, error.kind), {
        error: { code: error.serverCode ?? error.kind, message: error.message },
        submissionUncertain: error.submissionUncertain,
      });
    return reply(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Supply a valid revision, version and review decision.',
      },
    });
  }
}
