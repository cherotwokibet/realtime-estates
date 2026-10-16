import {
  ApiClientError,
  RealtorApiClient,
  type StaffEnquiryInput,
  type EnquiryInput,
} from './index.js';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const error = (status: number, code: string) =>
  Response.json(
    {
      error: { code, message: 'The synthetic enquiry could not be confirmed.' },
      requestId: crypto.randomUUID(),
    },
    { status, headers },
  );
const maximum = 16384;
/** Guest-only synthetic capture. Fixed deployment origin, no forwarded identity, bounded body and no retries. */
export async function handleSyntheticEnquiry(
  request: Request,
  config: {
    apiOrigin: string;
    noticeVersion: string;
    allowProperty?: boolean;
    staff?: Readonly<{ actor: 'admin' | 'agent'; bearerToken: string }>;
    authorize: (request: Request) => void;
  },
): Promise<Response> {
  try {
    config.authorize(request);
  } catch {
    return error(403, 'FORBIDDEN');
  }
  if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED');
  const url = new URL(request.url);
  const expectedPath = config.staff
    ? `/api/enquiry-preview/${config.staff.actor}/capture`
    : '/api/enquiry-intake';
  if (url.pathname !== expectedPath || url.search || url.hash) return error(400, 'INVALID_INPUT');
  let forbidden = false;
  request.headers.forEach((_, key) => {
    if (
      [
        'authorization',
        'cookie',
        'content-encoding',
        'transfer-encoding',
        'expect',
        'range',
        'x-tenant-id',
        'x-actor-id',
        'x-role',
      ].includes(key) ||
      key.startsWith('if-')
    )
      forbidden = true;
  });
  if (forbidden) return error(400, 'INVALID_INPUT');
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
  )
    return error(415, 'JSON_REQUIRED');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[1-9]\d{0,4}$/.test(length) || Number(length) > maximum))
    return error(413, 'BODY_TOO_LARGE');
  const key = request.headers.get('idempotency-key');
  if (
    !key ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
  )
    return error(400, 'INVALID_INPUT');
  const reader = request.body?.getReader();
  if (!reader) return error(400, 'INVALID_INPUT');
  let timer: ReturnType<typeof setTimeout> | undefined,
    dispatched = false;
  let rejectStop: (reason: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  void stopped.catch(() => undefined);
  const stop = () => {
    rejectStop(new Error('Stopped'));
    try {
      void reader.cancel().catch(() => undefined);
    } catch {}
  };
  try {
    const bytes = new Uint8Array(maximum);
    let used = 0;
    timer = setTimeout(stop, 15000);
    request.signal.addEventListener('abort', stop, { once: true });
    if (request.signal.aborted) stop();
    for (;;) {
      const item = await Promise.race([reader.read(), stopped]);
      if (item.done) break;
      if (
        !(item.value instanceof Uint8Array) ||
        item.value.length === 0 ||
        item.value.length > maximum - used
      )
        return error(413, 'BODY_TOO_LARGE');
      bytes.set(item.value, used);
      used += item.value.length;
    }
    if (!used || (length !== null && Number(length) !== used)) return error(400, 'INVALID_INPUT');
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
    const body: unknown = JSON.parse(source),
      fields = [
        'listingId',
        'name',
        'phone',
        'email',
        'message',
        ...(config.staff ? [] : ['origin']),
        'noticeVersion',
        'noticeAcknowledged',
      ];
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !fields.includes(k))
    )
      return error(400, 'INVALID_INPUT');
    // Inputs are scalar only. Reject escaped duplicate keys rather than silently replacing a contact or notice.
    const tokens =
      source.match(
        /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      ) ?? [];
    const keys = new Set<string>();
    for (let i = 0; i < tokens.length; i++)
      if (tokens[i]!.startsWith('"') && tokens[i + 1] === ':') {
        const k = JSON.parse(tokens[i]!);
        if (keys.has(k)) return error(400, 'INVALID_INPUT');
        keys.add(k);
      }
    const input = body as EnquiryInput;
    if (
      (!config.staff && input.origin !== 'web') ||
      (input.listingId !== null &&
        !(config.allowProperty === true && typeof input.listingId === 'string'))
    )
      return error(400, 'INVALID_INPUT');
    // A property ID is untrusted selection, never tenant authority. The fixed upstream SQL
    // checks current tenant/public eligibility for first capture and returns original receipts on replay.
    const client = new RealtorApiClient({
      baseUrl: config.apiOrigin,
      privacyNoticeVersion: config.noticeVersion,
      allowLoopbackHttp: true,
    });
    const attempt = config.staff
      ? client.prepareStaffEnquiryV2(input as StaffEnquiryInput, key, {
          bearerToken: config.staff.bearerToken,
        })
      : client.preparePublicEnquiry(input, key);
    dispatched = true;
    const receipt = await attempt.submit({ signal: request.signal, timeoutMs: 15000 });
    return Response.json(receipt, { status: 201, headers });
  } catch (e) {
    if (e instanceof ApiClientError && e.kind === 'VALIDATION') return error(400, 'INVALID_INPUT');
    if (
      e instanceof ApiClientError &&
      e.kind === 'HTTP' &&
      e.status !== undefined &&
      [400, 401, 403, 404, 409, 422, 429].includes(e.status)
    )
      return error(e.status, e.serverCode ?? 'INVALID_INPUT');
    return error(dispatched ? 503 : 400, dispatched ? 'SERVICE_UNAVAILABLE' : 'INVALID_INPUT');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', stop);
    try {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    } catch {}
  }
}
