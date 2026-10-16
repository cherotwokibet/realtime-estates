import 'server-only';
import {
  ApiClientError,
  RealtorApiClient,
  type MediaRegistrationInputV2,
  type MediaAttachIntentInputV2,
} from '@realtor/api-client';
import { parseListingJsonV2 } from '@realtor/domain';
import {
  assertPreviewRequest,
  previewConfiguration,
  upstreamFailureStatus,
} from './staff-preview-policy.ts';

const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function boundedBody(request: Request, max: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body.');
  const bytes = new Uint8Array(max);
  let length = 0;
  let expired = false;
  const deadline = performance.now() + 15000;
  const cancel = () => {
    expired = true;
    void reader.cancel().catch(() => {});
  };
  const timer = setTimeout(cancel, 15000);
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (expired || request.signal.aborted || performance.now() >= deadline)
        throw new Error('Cancelled.');
      const { done, value } = await reader.read();
      if (expired || request.signal.aborted || performance.now() >= deadline)
        throw new Error('Cancelled.');
      if (done) break;
      if (value.byteLength > max - length) throw new Error('Body too large.');
      if (value.byteLength) {
        bytes.set(value, length);
        length += value.byteLength;
      }
    }
    if (length === 0) throw new Error('Invalid body.');
    return bytes.slice(0, length);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
type Action =
  'register' | 'registration' | 'upload' | 'status' | 'intent' | 'attachment' | 'finalize';
async function emptyCommand(request: Request): Promise<void> {
  if (request.body === null) return;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Nonempty command.')), 1000);
  });
  try {
    for (let n = 0; n < 2; n++) {
      const chunk = await Promise.race([reader.read(), stopped]);
      if (chunk.done) return;
      if (chunk.value.byteLength !== 0) throw new Error('Nonempty command.');
    }
    throw new Error('Invalid empty stream.');
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function photoPreviewRequest(
  request: Request,
  params: {
    id: string;
    revision: string;
    registrationId?: string;
    jobId?: string;
    uploadId?: string;
    operationId?: string;
  },
  action: Action,
): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    if (process.env.STAFF_PREVIEW_MEDIA !== 'synthetic') throw new Error();
    assertPreviewRequest(
      request,
      config.instanceId,
      action === 'upload' ? 'binary' : action === 'finalize' ? 'empty' : 'json',
    );
  } catch {
    return reply(403, {
      error: {
        code: 'PREVIEW_UNAVAILABLE',
        message: 'Start the explicitly enabled local synthetic photo preview.',
      },
    });
  }
  const method = ['registration', 'status', 'attachment'].includes(action)
    ? 'GET'
    : action === 'upload'
      ? 'PUT'
      : 'POST';
  if (request.method !== method) return reply(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    }),
    options = { bearerToken: config.bearerToken, signal: request.signal, timeoutMs: 30000 };
  try {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      new URL(request.url).search ||
      !/^[1-9]\d*$/.test(params.revision) ||
      Number(params.revision) > 2147483647 ||
      !uuid.test(params.id) ||
      [params.registrationId, params.jobId, params.uploadId, params.operationId].some(
        (value) => value !== undefined && !uuid.test(value),
      ) ||
      request.headers.has('content-encoding') ||
      request.headers.has('expect')
    )
      throw new Error();
    const revision = Number(params.revision);
    if (action === 'registration')
      return reply(
        200,
        await client.getMediaRegistrationV2(
          params.id,
          revision,
          params.registrationId ?? '',
          options,
        ),
      );
    if (action === 'status')
      return reply(
        200,
        await client.getMediaUploadStatusV2(
          params.id,
          revision,
          params.jobId ?? '',
          params.uploadId ?? '',
          options,
        ),
      );
    if (action === 'attachment')
      return reply(
        200,
        await client.getMediaAttachIntentV2(params.id, revision, params.operationId ?? '', options),
      );
    if (action === 'finalize') {
      await emptyCommand(request);
      return reply(
        200,
        await client.finalizeMediaAttachIntentV2(
          params.id,
          revision,
          params.operationId ?? '',
          options,
        ),
      );
    }
    if (action === 'upload') {
      if (request.headers.has('content-encoding') || request.headers.has('expect'))
        throw new Error();
      const declared = request.headers.get('content-length');
      if (
        declared !== null &&
        (!/^[1-9]\d*$/.test(declared) || Number(declared) > 10 * 1024 * 1024)
      )
        throw new Error();
      const job = await client.getMediaJobV2(params.id, revision, params.jobId ?? '', options);
      if (job.state !== 'registered' || Date.parse(job.expiresAt) <= Date.now()) throw new Error();
      const input = await boundedBody(request, 10 * 1024 * 1024);
      if (declared !== null && input.length !== Number(declared)) throw new Error();
      return reply(
        200,
        await client.uploadMediaInputV2(
          params.id,
          revision,
          params.jobId ?? '',
          params.uploadId ?? '',
          input,
          options,
        ),
      );
    }
    const value = parseListingJsonV2(
      new TextDecoder('utf-8', { fatal: true }).decode(await boundedBody(request, 8192)),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return reply(
      200,
      action === 'register'
        ? await client.registerMediaUploadV2(
            params.id,
            revision,
            value as unknown as MediaRegistrationInputV2,
            options,
          )
        : await client.createMediaAttachIntentV2(
            params.id,
            revision,
            value as unknown as MediaAttachIntentInputV2,
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
        message: 'Supply a bounded synthetic photo and the original saved request.',
      },
    });
  }
}
