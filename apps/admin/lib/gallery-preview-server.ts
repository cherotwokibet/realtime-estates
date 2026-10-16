import 'server-only';
import {
  ApiClientError,
  RealtorApiClient,
  type MediaRemovalInputV2,
  type MediaReorderInputV2,
} from '@realtor/api-client';
import {
  assertPreviewRequest,
  previewConfiguration,
  upstreamFailureStatus,
} from './staff-preview-policy';
import { galleryCommandBody } from './gallery-preview-policy';

const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function boundedBody(request: Request): Promise<string> {
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
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function galleryPreviewRequest(
  request: Request,
  params: { id: string; revision: string; operationId?: string },
  action: 'workspace' | 'remove' | 'reorder' | 'operation',
): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, {
      error: {
        code: 'PREVIEW_UNAVAILABLE',
        message: 'Use the local synthetic staff launcher. Production sign-in is not configured.',
      },
    });
  }
  const write = action === 'remove' || action === 'reorder';
  if (request.method !== (write ? 'POST' : 'GET'))
    return reply(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
  });
  const options = { bearerToken: config.bearerToken };
  try {
    if (
      new URL(request.url).search ||
      !/^[1-9]\d*$/.test(params.revision) ||
      Number(params.revision) > 2147483647
    )
      throw new Error('Invalid resource.');
    const revision = Number(params.revision);
    if (action === 'workspace')
      return reply(200, await client.getStaffDraftWorkspaceV2(params.id, revision, options));
    if (action === 'operation')
      return reply(
        200,
        await client.getMediaOperationV2(params.id, revision, params.operationId ?? '', options),
      );
    const input = galleryCommandBody(await boundedBody(request), action);
    return reply(
      200,
      action === 'remove'
        ? await client.removeDraftMediaV2(
            params.id,
            revision,
            input as MediaRemovalInputV2,
            options,
          )
        : await client.reorderDraftMediaV2(
            params.id,
            revision,
            input as MediaReorderInputV2,
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
      error: { code: 'INVALID_INPUT', message: 'Supply an exact photo command and saved version.' },
    });
  }
}
