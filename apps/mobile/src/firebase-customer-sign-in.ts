import { validateCustomerAccount } from '@realtor/domain';
import { createMobileCustomerSession } from './customer-session.ts';
import { readNativeFirebaseConfig, type NativeFirebaseConfig } from './native-firebase-config.ts';

export interface NativePasswordProvider {
  password(
    email: string,
    password: string,
  ): Promise<Readonly<{ idToken: string; expiresAt: string; emailVerified: boolean }>>;
  dispose(): Promise<void>;
}
const unavailable = () => Error('Sign-in unavailable.');
/** No token decoding for authority. The server resolves the Firebase subject to the company account. */
export function createFirebaseMobileSignIn(
  input: NativeFirebaseConfig,
  options: {
    provider: () => NativePasswordProvider;
    uuid: () => string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
) {
  const config = readNativeFirebaseConfig(input);
  if (!config) throw unavailable();
  const transport = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw unavailable();
  const session = createMobileCustomerSession(
    { mode: 'runtime-customer-v1', tenantId: config.tenantId, apiOrigin: config.apiOrigin },
    transport,
  );
  let operation: AbortController | null = null,
    epoch = 0,
    disposed = false,
    failed = false,
    revision = 0;
  const listeners = new Set<() => void>();
  const publish = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const unsubscribe = session.subscribe(publish);
  function clear() {
    epoch++;
    operation?.abort();
    operation = null;
    failed = false;
    session.clear();
    publish();
  }
  return Object.freeze({
    session,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    snapshot: () =>
      Object.freeze({
        phase:
          session.snapshot().status === 'ready'
            ? ('ready' as const)
            : operation
              ? ('signing_in' as const)
              : failed
                ? ('unavailable' as const)
                : ('signed_out' as const),
      }),
    signOut: clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      unsubscribe();
      listeners.clear();
    },
    async signIn(email: string, password: string, signal?: AbortSignal): Promise<boolean> {
      if (disposed || operation || signal?.aborted) return false;
      clear();
      if (
        typeof email !== 'string' ||
        email.length > 320 ||
        email !== email.trim() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' ||
        !password ||
        password.length > 4096
      ) {
        failed = true;
        publish();
        return false;
      }
      const local = epoch,
        controller = new AbortController();
      operation = controller;
      const stop = () => controller.abort();
      const timer = setTimeout(stop, timeout);
      signal?.addEventListener('abort', stop, { once: true });
      let rejectCancellation!: (reason: Error) => void;
      const cancellation = new Promise<never>((_, reject) => {
        rejectCancellation = reject;
      });
      const abort = () => {
        session.clear();
        rejectCancellation(unavailable());
      };
      controller.signal.addEventListener('abort', abort, { once: true });
      let provider: NativePasswordProvider | null = null,
        cleanup: Promise<void> | null = null;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cleanupProvider = () => {
        if (!cleanup && provider) cleanup = Promise.resolve().then(() => provider!.dispose());
        return cleanup ?? Promise.resolve();
      };
      const check = () => {
        if (disposed || local !== epoch || controller.signal.aborted) throw unavailable();
      };
      publish();
      try {
        provider = options.provider();
        const credential = await Promise.race([provider.password(email, password), cancellation]);
        // Remove the SDK's in-memory refresh session before making private application requests.
        await Promise.race([cleanupProvider(), cancellation]);
        check();
        const expiry = Date.parse(credential.expiresAt),
          now = Date.now();
        if (
          credential.emailVerified !== true ||
          !Number.isFinite(expiry) ||
          expiry <= now ||
          expiry > now + 3600000 ||
          typeof credential.idToken !== 'string' ||
          credential.idToken.length > 8192 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential.idToken)
        )
          throw unavailable();
        const url = config.apiOrigin + '/v2/customer/account';
        const pending = transport(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + credential.idToken },
        });
        void pending.then(
          (response) => {
            if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
          },
          () => {},
        );
        const response = await Promise.race([pending, cancellation]);
        if (
          response.status !== 200 ||
          response.redirected ||
          response.url !== url ||
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
            response.headers.get('content-type') ?? '',
          ) ||
          !response.headers
            .get('cache-control')
            ?.split(',')
            .some((x) => x.trim().toLowerCase() === 'no-store')
        ) {
          void response.body?.cancel().catch(() => {});
          throw unavailable();
        }
        reader = response.body?.getReader();
        if (!reader) throw unavailable();
        const bytes = new Uint8Array(4096);
        let size = 0,
          complete = false;
        for (let chunks = 0; chunks < 128; chunks++) {
          const part = await Promise.race([reader.read(), cancellation]);
          check();
          if (part.done) {
            complete = true;
            break;
          }
          if (size + part.value.byteLength > bytes.length) throw unavailable();
          bytes.set(part.value, size);
          size += part.value.byteLength;
        }
        if (!complete) throw unavailable();
        const value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        );
        const account = validateCustomerAccount(value, {
          tenantId: config.tenantId,
          customerId: value?.customerId,
        });
        check();
        const accepted = await Promise.race([
          session.activate({
            policy: 'runtime-customer-grant-v1',
            tenantId: account.tenantId,
            customerId: account.customerId,
            generation: options.uuid(),
            expiresAt: new Date(Math.min(expiry, Date.now() + 300000)).toISOString(),
            bearerToken: credential.idToken,
          }),
          cancellation,
        ]);
        check();
        if (!accepted) throw unavailable();
        return true;
      } catch {
        if (epoch === local) {
          session.clear();
          failed = !controller.signal.aborted;
        }
        return false;
      } finally {
        // Cleanup is always invoked, including a provider that completes after cancellation.
        void cleanupProvider().catch(() => {});
        if (reader) {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        controller.signal.removeEventListener('abort', abort);
        if (epoch === local) {
          operation = null;
          publish();
        }
      }
    },
  });
}
