import { ApiClientError } from '@realtor/api-client';
import { validateListingVideoCommand, validateListingVideoRecord } from '@realtor/domain';
import { captureVideoScope, type VideoScope, type VideoClient } from './listing-video-session.ts';
import { readBrowserDecodedJson } from './browser-decoded-json.ts';
export function createListingVideoClient(
  input: VideoScope,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
): VideoClient {
  const scope = captureVideoScope(input);
  async function run(
    input: Parameters<VideoClient['save']>[0],
    recover: boolean,
    caller?: AbortSignal,
  ) {
    const c = validateListingVideoCommand(input);
    if (c.listingId !== scope.listingId || c.revision !== scope.revision)
      throw Error('Changed video scope.');
    const deadline = new AbortController(),
      timer = setTimeout(() => deadline.abort(), 15000),
      signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
    let started = false,
      abort = () => {};
    try {
      if (signal.aborted) throw Error('Cancelled.');
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(Error('Cancelled.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      started = !recover;
      const r = await Promise.race([
        transport(
          `/api/staff/listings/${c.listingId}/video-operations/${c.operationId}${recover ? '/recover' : ''}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Preview-Instance': scope.instanceId,
              'X-Reference-Actor': scope.actorId,
              'X-Reference-Tenant': scope.tenantId,
            },
            body: JSON.stringify(c),
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            signal,
          },
        ),
        cancelled,
      ]);
      if (r.redirected || !r.headers.get('cache-control')?.split(/[ ,]+/).includes('no-store'))
        throw Error('Invalid private response.');
      const data = await readBrowserDecodedJson(r, 8192, signal);
      if (!r.ok) {
        const e = data as { submissionUncertain?: unknown };
        if (typeof e?.submissionUncertain !== 'boolean') throw Error('Invalid refusal.');
        throw new ApiClientError('HTTP', 'Private video request unavailable.', {
          status: r.status,
          submissionUncertain: !recover && e.submissionUncertain,
        });
      }
      const result = validateListingVideoRecord(data, c);
      if (result.actorId !== scope.actorId || signal.aborted) throw Error('Changed actor.');
      return result;
    } catch (e) {
      if (e instanceof ApiClientError && e.kind === 'HTTP') throw e;
      throw new ApiClientError(
        deadline.signal.aborted ? 'TIMEOUT' : caller?.aborted ? 'CANCELLED' : 'INVALID_RESPONSE',
        'Keep the video original.',
        { submissionUncertain: started },
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  return Object.freeze({
    save: (c, s) => run(c, false, s),
    recover: (c, s) => run(c, true, s),
  } satisfies VideoClient);
}
