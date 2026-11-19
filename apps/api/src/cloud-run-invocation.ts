type Environment = Readonly<Record<string, string | undefined>>;
export interface CloudRunInvocationConfig {
  readonly policy: 'cloud-run-invocation-v1';
  readonly audience: string;
}
function canonicalOrigin(value: string) {
  const u = new URL(value);
  if (
    u.origin !== value ||
    u.protocol !== 'https:' ||
    u.port ||
    !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\.){1,2}run\.app$/.test(u.hostname)
  )
    throw Error('Canonical Cloud Run service URL required.');
  return u.origin;
}
/** Server-only settings. Cloud Run targets cannot silently use public unauthenticated fetch. */
export function readCloudRunInvocationEnvironment(
  env: Environment,
  apiOrigin: string,
  projectId: string,
): CloudRunInvocationConfig | null {
  const raw = env.HOSTED_API_INVOCATION_CONFIG;
  if (raw === undefined) {
    if (new URL(apiOrigin).hostname.endsWith('.run.app'))
      throw Error('Private API invocation is required.');
    return null;
  }
  if (
    env.NODE_ENV !== 'production' ||
    env.APP_ENV !== 'staging' ||
    !env.K_SERVICE ||
    env.GOOGLE_CLOUD_PROJECT !== projectId ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
    env.GOOGLE_APPLICATION_CREDENTIALS !== undefined ||
    raw.length > 2048
  )
    throw Error('Attached staging workload identity required.');
  const c = JSON.parse(raw);
  if (
    !c ||
    typeof c !== 'object' ||
    Array.isArray(c) ||
    Object.keys(c).sort().join(',') !== 'audience,policy' ||
    c.policy !== 'cloud-run-invocation-v1' ||
    typeof c.audience !== 'string' ||
    c.audience !== apiOrigin
  )
    throw Error('Invalid private API invocation settings.');
  return Object.freeze({ policy: c.policy, audience: canonicalOrigin(c.audience) });
}
interface TokenClient {
  getRequestHeaders(): Promise<Headers>;
}
interface Dependencies {
  client?: (audience: string) => Promise<TokenClient>;
  transport?: typeof fetch;
  timeoutMs?: number;
}
/** The Google client only obtains/caches service identity. It never sends or retries application requests. */
export function createCloudRunInvocationTransport(
  input: CloudRunInvocationConfig,
  dependencies: Dependencies = {},
): typeof fetch {
  if (input.policy !== 'cloud-run-invocation-v1') throw Error('Invalid invocation policy.');
  const audience = canonicalOrigin(input.audience),
    timeout = dependencies.timeoutMs ?? 5000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10000)
    throw Error('Invalid invocation deadline.');
  const transport = dependencies.transport ?? fetch;
  let client: Promise<TokenClient> | undefined, pending: Promise<string> | undefined;
  function token() {
    if (!pending)
      pending = (async () => {
        if (!client)
          client = (
            dependencies.client ??
            (async (target) => {
              const { GoogleAuth } = await import('google-auth-library');
              return new GoogleAuth().getIdTokenClient(target);
            })
          )(audience).catch(() => {
            client = undefined;
            throw Error('Service identity unavailable.');
          });
        const value = (await (await client).getRequestHeaders()).get('authorization');
        if (
          !value ||
          value.length > 16384 ||
          !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
        )
          throw Error('Service identity unavailable.');
        return value;
      })().finally(() => {
        pending = undefined;
      });
    return pending;
  }
  return async (input, init) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    try {
      const request = new Request(input, init),
        u = new URL(request.url);
      if (
        u.origin !== audience ||
        u.hash ||
        u.username ||
        u.password ||
        !/^\/v2\/(customer|staff)\//.test(u.pathname) ||
        !['GET', 'POST'].includes(request.method) ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
          request.headers.get('authorization') ?? '',
        ) ||
        [
          'x-serverless-authorization',
          'cookie',
          'x-actor-id',
          'x-tenant-id',
          'x-role',
          'x-company-id',
        ].some((h) => request.headers.has(h))
      )
        throw Error('Invalid private request.');
      const deadline = new AbortController();
      timer = setTimeout(() => deadline.abort(), timeout);
      signal = AbortSignal.any([request.signal, deadline.signal]);
      if (signal.aborted) throw Error('Private request cancelled.');
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(Error('Private request cancelled.'));
        signal!.addEventListener('abort', abort, { once: true });
      });
      if (signal.aborted) throw Error('Private request cancelled.');
      const service = await Promise.race([token(), cancelled]);
      if (signal.aborted) throw Error('Private request cancelled.');
      const headers = new Headers(request.headers);
      headers.set('x-serverless-authorization', service);
      const outgoing = new Request(request, {
        headers,
        signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const response = await Promise.race([transport(outgoing), cancelled]);
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400) ||
        (response.url && new URL(response.url).origin !== audience)
      ) {
        await response.body?.cancel();
        throw Error('Private API redirect refused.');
      }
      return response;
    } catch {
      // No provider diagnostics, bearer tokens, fallback fetch or automatic write retry.
      throw Error('Private API unavailable.');
    } finally {
      clearTimeout(timer);
      if (signal && abort) signal.removeEventListener('abort', abort);
    }
  };
}
export function configuredHostedApiTransport(
  env: Environment,
  apiOrigin: string,
  projectId: string,
): typeof fetch {
  const config = readCloudRunInvocationEnvironment(env, apiOrigin, projectId);
  return config ? createCloudRunInvocationTransport(config) : fetch;
}
