import type { MobileCustomerGrant } from './customer-session.ts';

export const syntheticCustomerMode = 'synthetic-mobile-customer-v1';
export const syntheticCustomerCompanyId = (slug: 'sample-homes' | 'realtime-estates') =>
  slug === 'sample-homes'
    ? '00000000-0000-4000-8000-000000000002'
    : '00000000-0000-4000-8000-000000000001';

export async function requestSyntheticCustomerGrant(
  apiOrigin: string,
  tenantId: string,
  persona: 'a' | 'b',
  caller: AbortSignal,
  transport: typeof fetch,
): Promise<MobileCustomerGrant | null> {
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(apiOrigin) || caller.aborted) return null;
  const url = apiOrigin + '/dev/mobile-customer/session';
  const controller = new AbortController();
  const stop = () => controller.abort();
  caller.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, 5000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  const cancelled = new Promise<null>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(null), { once: true });
  });
  try {
    const pending = transport(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'X-Realtor-Preview-Customer': persona },
      signal: controller.signal,
    });
    void pending.then(
      (response) => {
        if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await Promise.race([pending, cancelled]);
    if (!response) return null;
    if (
      response.status !== 200 ||
      response.url !== url ||
      response.redirected ||
      response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
      response.headers.get('cache-control') !== 'no-store' ||
      response.headers.get('x-content-type-options') !== 'nosniff'
    ) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    reader = response.body?.getReader();
    if (!reader) return null;
    const bytes = new Uint8Array(8192);
    let size = 0;
    for (let chunks = 0; chunks < 128; chunks++) {
      const part = await Promise.race([reader.read(), cancelled]);
      if (!part || controller.signal.aborted) return null;
      if (part.done) {
        finished = true;
        break;
      }
      if (size + part.value.byteLength > bytes.length) return null;
      bytes.set(part.value, size);
      size += part.value.byteLength;
    }
    if (!finished) return null;
    const grant = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
    );
    const expected = '00000000-0000-4000-8000-0000000000' + (persona === 'a' ? '13' : '14');
    // The session controller validates the complete grant and confirms the signed account.
    return grant?.tenantId === tenantId && grant.customerId === expected ? grant : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    caller.removeEventListener('abort', stop);
    if (reader && !finished) void reader.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
