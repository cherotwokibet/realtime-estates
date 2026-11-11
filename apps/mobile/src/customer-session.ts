import { CustomerFavouritesClient, CustomerApiError } from '@realtor/api-client';
import {
  validateCustomerFavouriteCommand,
  type CustomerFavouriteCommand,
  type CustomerFavouriteReceipt,
  validateCustomerPushCommand,
  type CustomerPushCommand,
  type CustomerPushPreferences,
} from '@realtor/domain';

/** Runtime identity-provider result. Never place this in Expo extras, UI or disk storage. */
export interface MobileCustomerGrant {
  readonly policy: 'runtime-customer-grant-v1';
  readonly tenantId: string;
  readonly customerId: string;
  readonly generation: string;
  readonly expiresAt: string;
  readonly bearerToken: string;
}
export interface MobileCustomerConfig {
  readonly mode: 'runtime-customer-v1';
  readonly tenantId: string;
  readonly apiOrigin: string;
  readonly allowLoopbackHttp?: boolean;
  readonly pushMode?: 'synthetic-customer-push-v1';
}
type Phase = 'idle' | 'busy' | 'uncertain' | 'missing' | 'settled';
interface PushSettings {
  phase: 'idle' | 'loading' | 'ready' | 'busy' | 'uncertain' | 'missing' | 'unavailable';
  pending: CustomerPushCommand | null;
  preferences: CustomerPushPreferences | null;
  conflict?: true;
}
interface Active {
  readonly grant: MobileCustomerGrant;
  readonly client: CustomerFavouritesClient;
  readonly controller: AbortController;
  phase: Phase;
  pending: CustomerFavouriteCommand | null;
  receipt: CustomerFavouriteReceipt | null;
  push: PushSettings | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fields(input: unknown, required: string[], optional: string[] = []) {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw Error('Customer session unavailable.');
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || ![...required, ...optional].includes(key))
      throw Error('Customer session unavailable.');
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('Customer session unavailable.');
    out[key] = d.value;
  }
  if (required.some((key) => !Object.hasOwn(out, key)))
    throw Error('Customer session unavailable.');
  return out;
}
/** In-memory native controller, disabled unless explicitly constructed with runtime configuration.
 * No provider sign-in, credential persistence, automatic retry or app/build activation.
 */
export function createMobileCustomerSession(
  input?: MobileCustomerConfig,
  transport: typeof globalThis.fetch = globalThis.fetch,
) {
  const config =
    input === undefined
      ? null
      : fields(input, ['mode', 'tenantId', 'apiOrigin'], ['allowLoopbackHttp', 'pushMode']);
  if (
    config &&
    (config.mode !== 'runtime-customer-v1' ||
      typeof config.tenantId !== 'string' ||
      !uuid.test(config.tenantId) ||
      (config.pushMode !== undefined &&
        (config.pushMode !== 'synthetic-customer-push-v1' ||
          config.allowLoopbackHttp !== true ||
          typeof config.apiOrigin !== 'string' ||
          !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(config.apiOrigin))))
  )
    throw Error('Customer session unavailable.');
  // Reuse SDK authority/origin validation before accepting a runtime grant.
  if (config)
    new CustomerFavouritesClient({
      baseUrl: config.apiOrigin as string,
      scope: { tenantId: config.tenantId as string, customerId: config.tenantId as string },
      allowLoopbackHttp: config.allowLoopbackHttp as boolean | undefined,
      fetch: transport,
    });
  const origin = config ? new URL(config.apiOrigin as string).origin : null;
  const listeners = new Set<() => void>();
  let revision = 0;
  function publish() {
    revision++;
    for (const listener of listeners) listener();
  }
  let active: Active | null = null;
  let generation = 0;
  let activating = false;
  let activationController: AbortController | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    generation++;
    const previousActivation = activationController;
    activationController = null;
    previousActivation?.abort();
    activating = false;
    clearTimeout(expiry);
    expiry = undefined;
    const previous = active;
    active = null;
    if (previous) {
      previous.pending = null;
      previous.receipt = null;
      previous.push = null;
      previous.controller.abort();
    }
    publish();
  }
  function current() {
    if (active && Date.parse(active.grant.expiresAt) <= Date.now()) clear();
    return active;
  }
  function valid(s: Active) {
    return current() === s && !s.controller.signal.aborted;
  }
  const auth = (s: Active) => ({ bearerToken: s.grant.bearerToken, signal: s.controller.signal });
  function refused(s: Active, error: unknown) {
    if (
      valid(s) &&
      error instanceof CustomerApiError &&
      ['unauthenticated', 'forbidden'].includes(error.kind)
    )
      clear();
  }
  async function send(s: Active) {
    const command = s.pending!;
    s.phase = 'busy';
    publish();
    try {
      const receipt = await s.client.setFavourite(command, auth(s));
      if (!valid(s)) return false;
      s.receipt = receipt;
      s.phase = 'settled';
      publish();
      return true;
    } catch (error) {
      refused(s, error);
      if (!valid(s)) return false;
      if (error instanceof CustomerApiError && !error.submissionUncertain) {
        s.pending = null;
        s.phase = 'idle';
      } else s.phase = 'uncertain';
      publish();
      return false;
    }
  }
  async function readPush(s: Active, push: PushSettings, conflict = false) {
    push.phase = 'loading';
    delete push.conflict;
    push.preferences = null;
    publish();
    try {
      const preferences = await s.client.getPushPreferences(auth(s));
      if (!valid(s)) return false;
      push.preferences = preferences;
      push.phase = 'ready';
      if (conflict) push.conflict = true;
      publish();
      return true;
    } catch (error) {
      refused(s, error);
      if (valid(s)) {
        push.phase = 'unavailable';
        publish();
      }
      return false;
    }
  }
  async function runPush(s: Active, push: PushSettings, mode: 'send' | 'recover' | 'retry') {
    const command = push.pending!;
    push.phase = 'busy';
    delete push.conflict;
    push.preferences = null;
    publish();
    try {
      const receipt =
        mode === 'recover'
          ? await s.client.getPushOriginal(command, auth(s))
          : await s.client.changePushPreferences(command, auth(s));
      if (!valid(s)) return false;
      push.pending = null;
      // An original receipt can describe consent that has since been withdrawn.
      const refreshed = await readPush(s, push, receipt.outcome === 'conflict');
      return refreshed && receipt.outcome !== 'conflict';
    } catch (error) {
      if (
        mode === 'recover' ||
        (error instanceof CustomerApiError && error.kind === 'unauthenticated')
      )
        refused(s, error);
      if (!valid(s)) return false;
      if (mode === 'recover' && error instanceof CustomerApiError && error.status === 404) {
        push.phase = 'missing';
      } else if (
        mode !== 'send' ||
        !(error instanceof CustomerApiError) ||
        error.submissionUncertain
      ) {
        push.phase = 'uncertain';
      } else {
        push.pending = null;
        push.phase = 'unavailable';
      }
      publish();
      return false;
    }
  }
  return Object.freeze({
    clear,
    matches(tenantId: string, apiOrigin: string) {
      return config !== null && config.tenantId === tenantId && origin === apiOrigin;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    snapshot() {
      const s = active && Date.parse(active.grant.expiresAt) > Date.now() ? active : null;
      return Object.freeze(
        s
          ? {
              status: 'ready' as const,
              activation: generation,
              account: Object.freeze({
                tenantId: s.grant.tenantId,
                customerId: s.grant.customerId,
                generation: s.grant.generation,
                expiresAt: s.grant.expiresAt,
              }),
              phase: s.phase,
              pending: s.pending,
              receipt: s.receipt,
              ...(s.push
                ? {
                    push: Object.freeze({
                      phase: s.push.phase,
                      preferences: s.push.preferences,
                      ...(s.push.conflict ? { conflict: true as const } : {}),
                    }),
                  }
                : {}),
            }
          : {
              status: config
                ? activating
                  ? ('activating' as const)
                  : ('signed_out' as const)
                : ('off' as const),
            },
      );
    },
    async activate(input: MobileCustomerGrant): Promise<boolean> {
      clear();
      if (!config) return false;
      const local = generation;
      try {
        const r = fields(input, [
          'policy',
          'tenantId',
          'customerId',
          'generation',
          'expiresAt',
          'bearerToken',
        ]);
        if (
          r.policy !== 'runtime-customer-grant-v1' ||
          r.tenantId !== config.tenantId ||
          typeof r.customerId !== 'string' ||
          !uuid.test(r.customerId) ||
          typeof r.generation !== 'string' ||
          !uuid.test(r.generation) ||
          typeof r.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(r.expiresAt)) ||
          new Date(r.expiresAt).toISOString() !== r.expiresAt ||
          Date.parse(r.expiresAt) <= Date.now() ||
          Date.parse(r.expiresAt) > Date.now() + 600000 ||
          typeof r.bearerToken !== 'string' ||
          r.bearerToken.length > 8192 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.bearerToken)
        )
          return false;
        const grant = Object.freeze(r) as unknown as MobileCustomerGrant;
        const client = new CustomerFavouritesClient({
          baseUrl: config.apiOrigin as string,
          scope: { tenantId: grant.tenantId, customerId: grant.customerId },
          allowLoopbackHttp: config.allowLoopbackHttp as boolean | undefined,
          fetch: transport,
        });
        const controller = new AbortController();
        activationController = controller;
        activating = true;
        expiry = setTimeout(clear, Date.parse(grant.expiresAt) - Date.now());
        publish();
        await client.getAccount({ bearerToken: grant.bearerToken, signal: controller.signal });
        if (
          generation !== local ||
          controller.signal.aborted ||
          Date.parse(grant.expiresAt) <= Date.now()
        )
          return false;
        activating = false;
        activationController = null;
        active = {
          grant,
          client,
          controller,
          phase: 'idle',
          pending: null,
          receipt: null,
          push: config.pushMode ? { phase: 'idle', pending: null, preferences: null } : null,
        };
        publish();
        return true;
      } catch {
        if (generation === local) clear();
        return false;
      }
    },
    async loadPushPreferences() {
      const s = current();
      const push = s?.push;
      if (!s || !push || push.pending || push.phase === 'loading') return false;
      return readPush(s, push);
    },
    async changePushPreferences(input: CustomerPushCommand) {
      const s = current();
      const push = s?.push;
      if (!s || !push || push.phase !== 'ready' || !push.preferences) return false;
      try {
        const command = validateCustomerPushCommand(input);
        if (command.expectedVersion !== push.preferences.version) return false;
        push.pending = command;
      } catch {
        return false;
      }
      return runPush(s, push, 'send');
    },
    async recoverPushPreferences() {
      const s = current();
      const push = s?.push;
      return s && push?.phase === 'uncertain' && push.pending ? runPush(s, push, 'recover') : false;
    },
    async retryPushPreferences() {
      const s = current();
      const push = s?.push;
      return s && push?.phase === 'missing' && push.pending ? runPush(s, push, 'retry') : false;
    },
    async favourite(listingId: string) {
      const s = current();
      if (!s) return null;
      try {
        const value = await s.client.getFavourite(listingId, auth(s));
        return valid(s) ? value : null;
      } catch (error) {
        refused(s, error);
        return null;
      }
    },
    async list(page: { readonly limit?: number; readonly after?: string } = {}) {
      const s = current();
      if (!s) return null;
      try {
        const value = await s.client.listFavourites(auth(s), page);
        return valid(s) ? value : null;
      } catch (error) {
        refused(s, error);
        return null;
      }
    },
    async save(input: CustomerFavouriteCommand) {
      const s = current();
      if (!s || s.phase !== 'idle') return false;
      try {
        s.pending = validateCustomerFavouriteCommand(input);
      } catch {
        return false;
      }
      return send(s);
    },
    async recover() {
      const s = current();
      if (!s || s.phase !== 'uncertain' || !s.pending) return false;
      s.phase = 'busy';
      publish();
      try {
        const receipt = await s.client.getFavouriteOriginal(s.pending, auth(s));
        if (!valid(s)) return false;
        s.receipt = receipt;
        s.phase = 'settled';
        publish();
        return true;
      } catch (error) {
        refused(s, error);
        if (valid(s)) {
          s.phase =
            error instanceof CustomerApiError && error.status === 404 ? 'missing' : 'uncertain';
          publish();
        }
        return false;
      }
    },
    async retry() {
      const s = current();
      return s?.phase === 'missing' && s.pending ? send(s) : false;
    },
    settle() {
      const s = current();
      if (!s || s.phase !== 'settled' || !s.receipt) return false;
      s.pending = null;
      s.receipt = null;
      s.phase = 'idle';
      publish();
      return true;
    },
  });
}

export type MobileCustomerSession = ReturnType<typeof createMobileCustomerSession>;
