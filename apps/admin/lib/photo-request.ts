export type PhotoRequestFailure = { readonly status: number; readonly uncertain: boolean };
/** One attempt only. Aborting stops waiting; it never proves server rollback. */
export async function photoRequest(
  path: string,
  instance: string,
  method = 'GET',
  body?: unknown,
  binary?: File,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController(),
    cancel = () => controller.abort();
  const timer = setTimeout(cancel, 35000);
  try {
    if (externalSignal?.aborted) cancel();
    else externalSignal?.addEventListener('abort', cancel, { once: true });
    let response: Response;
    try {
      if (controller.signal.aborted) throw Error('Request aborted before dispatch.');
      response = await fetch(path, {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'X-Preview-Instance': instance,
          ...(binary
            ? { 'Content-Type': 'application/octet-stream' }
            : body
              ? { 'Content-Type': 'application/json' }
              : {}),
        },
        ...(binary ? { body: binary } : body ? { body: JSON.stringify(body) } : {}),
      });
      // A transport ignoring cancellation may still return a committed response.
      // Require original-result readback before this UI adopts it after cancellation.
      if (controller.signal.aborted) throw Error('Request aborted while waiting.');
    } catch {
      throw { status: 0, uncertain: method !== 'GET' } satisfies PhotoRequestFailure;
    }
    let data: unknown;
    try {
      data = await response.json();
      if (controller.signal.aborted) throw Error('Request aborted while reading.');
    } catch {
      throw { status: response.status, uncertain: method !== 'GET' } satisfies PhotoRequestFailure;
    }
    if (!response.ok)
      throw {
        status: response.status,
        uncertain:
          (data as { submissionUncertain?: boolean })?.submissionUncertain === true ||
          response.status >= 500,
      } satisfies PhotoRequestFailure;
    return data;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', cancel);
  }
}
