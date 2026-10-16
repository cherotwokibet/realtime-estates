/** Fixed same-origin guest transport. No caller-supplied route, identity or tenant headers. */
export function createEnquiryProxyTransport(options: {
  origin: string;
  instanceId: string;
  fetch: typeof globalThis.fetch;
}): typeof globalThis.fetch {
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    origin.username ||
    origin.password ||
    !['https:', 'http:'].includes(origin.protocol) ||
    (origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
  ) {
    throw new Error('A secure application origin is required.');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      options.instanceId,
    )
  ) {
    throw new Error('A preview instance is required.');
  }
  const instanceId = options.instanceId,
    transport = options.fetch;
  const apiUrl = origin.origin + '/v1/enquiries',
    proxyUrl = origin.origin + '/api/enquiry-intake';
  return async (url, init) => {
    if (String(url) !== apiUrl || init?.method !== 'POST' || typeof init.body !== 'string') {
      throw new Error('Unsupported intake operation.');
    }
    const headers = new Headers(init.headers);
    headers.forEach((_, name) => {
      if (!['content-type', 'accept', 'idempotency-key'].includes(name)) {
        throw new Error('Unsupported intake header.');
      }
    });
    headers.set('X-Preview-Instance', instanceId);
    // Explicitly omit ambient login cookies. Redirects must never forward contact data.
    const response = await transport(proxyUrl, {
      method: 'POST',
      body: init.body,
      signal: init.signal,
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.redirected || response.url !== proxyUrl) {
      try {
        await response.body?.cancel();
      } catch {
        /* Preserve destination failure. */
      }
      throw new Error('Unexpected intake destination.');
    }
    // The fixed proxy destination has been checked; neutralize its URL for SDK API validation.
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
}
