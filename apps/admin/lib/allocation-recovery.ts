import {
  validateListingCreationCommand,
  validateListingCreationReceipt,
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  type ListingCreationCommand,
  type ListingCreationReceipt,
  type ListingSuccessorCommand,
  type ListingSuccessorReceipt,
} from '@realtor/api-client';
import { ListingCreationError, type ListingCreationClient } from './listing-creation-client.ts';
import { ListingSuccessorError, type ListingSuccessorClient } from './listing-successor-client.ts';
import { parseVerificationJson } from './listing-verification-wire.ts';
import { validateStaffListingSummary, type StaffListingSummary } from '@realtor/domain';

export interface AllocationIdentity {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly actorId: string;
}
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export class AllocationRecoveryError extends Error {
  constructor() {
    super('Keep and verify the original allocation before continuing.');
  }
}
const fail = (): never => {
  throw new AllocationRecoveryError();
};
const uuid = (v: unknown): string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
    ? v
    : fail();
function own(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    return fail();
  const out: Record<string, unknown> = {};
  for (const k of fields) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    out[k] = d.value;
  }
  return out;
}
export function captureAllocationIdentity(input: AllocationIdentity): AllocationIdentity {
  const v = own(input, ['instanceId', 'tenantId', 'actorId']);
  return Object.freeze({
    instanceId: uuid(v.instanceId),
    tenantId: uuid(v.tenantId),
    actorId: uuid(v.actorId),
  });
}
export const ALLOCATION_STORAGE_MAX_BYTES = 262144;
function session<C extends { listingId: string }>(
  store: Store,
  identityInput: AllocationIdentity,
  kind: 'creation' | 'successor',
  validate: (v: unknown) => C,
  target?: string,
) {
  const identity = captureAllocationIdentity(identityInput),
    listing = target === undefined ? null : uuid(target);
  if (kind === 'successor' && listing === null) return fail();
  const key = `staff-allocation-original-v2:${kind}:${identity.instanceId}:${identity.tenantId}:${identity.actorId}${listing ? ':' + listing : ''}`;
  const capture = (input: unknown) => {
    const c = validate(input);
    if (listing !== null && c.listingId !== listing) return fail();
    return c;
  };
  const encode = (command: C) =>
    JSON.stringify({
      schema: 'staff-allocation-original-v2',
      kind,
      ...identity,
      target: listing,
      command,
    });
  const bound = (raw: string) => {
    if (
      raw.length > ALLOCATION_STORAGE_MAX_BYTES ||
      new TextEncoder().encode(raw).byteLength > ALLOCATION_STORAGE_MAX_BYTES
    )
      return fail();
  };
  function load(): C | null {
    const raw = store.getItem(key);
    if (raw === null) return null;
    bound(raw);
    const row = own(parseVerificationJson(raw), [
      'schema',
      'kind',
      'instanceId',
      'tenantId',
      'actorId',
      'target',
      'command',
    ]);
    if (
      row.schema !== 'staff-allocation-original-v2' ||
      row.kind !== kind ||
      row.target !== listing ||
      Object.keys(identity).some((k) => row[k] !== identity[k as keyof AllocationIdentity])
    )
      return fail();
    const command = capture(row.command);
    if (encode(command) !== raw) return fail();
    return command;
  }
  const verify = (input: C) => {
    const c = capture(input);
    if (store.getItem(key) !== encode(c)) return fail();
  };
  return Object.freeze({
    identity,
    load,
    capture,
    retain(input: C) {
      const command = capture(input),
        raw = encode(command);
      bound(raw);
      if (store.getItem(key) !== null) return fail();
      store.setItem(key, raw);
      if (store.getItem(key) !== raw) return fail();
    },
    verify,
    clear(input: C) {
      verify(input);
      store.removeItem(key);
      if (store.getItem(key) !== null) return fail();
    },
  });
}
export const creationAllocationSession = (store: Store, identity: AllocationIdentity) =>
  session(store, identity, 'creation', validateListingCreationCommand);
export const successorAllocationSession = (
  store: Store,
  identity: AllocationIdentity,
  listingId: string,
) => session(store, identity, 'successor', validateListingSuccessorCommand, listingId);
type Session<C> = {
  identity: AllocationIdentity;
  load(): C | null;
  retain(c: C): void;
  verify(c: C): void;
  clear(c: C): void;
};
type Client<C, R> = {
  create(c: C, s?: AbortSignal): Promise<R>;
  recover(c: C, s?: AbortSignal): Promise<R>;
};
function attempt<C extends { listingId: string }, R>(
  client: Client<C, R>,
  storage: Session<C>,
  input: C,
  validate: (v: unknown) => C,
  receiptCheck: (v: unknown, c: C, actor: string) => R,
  target: (r: R) => Readonly<{ listingId: string; revision: number }> | null,
  restored: boolean,
) {
  const original = validate(input),
    create = client.create.bind(client),
    recover = client.recover.bind(client);
  let status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected' = restored
      ? 'uncertain'
      : 'ready',
    receipt: R | null = null,
    discarded = false;
  async function run(mode: 'submit' | 'recover' | 'replay', signal?: AbortSignal) {
    if (
      discarded ||
      status !== (mode === 'submit' ? 'ready' : 'uncertain') ||
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      signal?.aborted
    )
      return fail();
    const wasUncertain = status === 'uncertain';
    if (mode === 'submit') {
      if (storage.load() !== null) return fail();
      storage.retain(original);
    } else storage.verify(original);
    status = 'sending';
    try {
      const result = await (mode === 'recover' ? recover : create)(original, signal);
      // A reply cannot confirm an operation whose retained original changed in flight.
      if (signal?.aborted) throw new AllocationRecoveryError();
      storage.verify(original);
      receipt = receiptCheck(result, original, storage.identity.actorId);
      status = 'received';
      return receipt;
    } catch (error) {
      status =
        wasUncertain ||
        (!(error instanceof ListingCreationError) && !(error instanceof ListingSuccessorError)) ||
        error.uncertain
          ? 'uncertain'
          : 'rejected';
      throw error;
    }
  }
  return Object.freeze({
    original,
    get status() {
      return status;
    },
    get receipt() {
      return receipt;
    },
    get canDiscard() {
      return !discarded && status !== 'sending' && status !== 'uncertain';
    },
    get canLeave() {
      return discarded || (status !== 'sending' && status !== 'uncertain');
    },
    get freshDraftTarget() {
      return !discarded && status === 'received' && receipt ? target(receipt) : null;
    },
    verifyReload() {
      if (discarded || status !== 'uncertain') return fail();
      storage.verify(original);
    },
    submit: (s?: AbortSignal) => run('submit', s),
    recoverOriginal: (s?: AbortSignal) => run('recover', s),
    replayOriginal: (s?: AbortSignal) => run('replay', s),
    discard() {
      if (discarded || status === 'sending' || status === 'uncertain') return fail();
      if (storage.load() !== null) storage.clear(original);
      discarded = true;
    },
  });
}
function creation(
  client: ListingCreationClient,
  storage: ReturnType<typeof creationAllocationSession>,
  command: ListingCreationCommand,
  restored: boolean,
) {
  return attempt(
    client,
    storage,
    command,
    validateListingCreationCommand,
    validateListingCreationReceipt,
    (r: ListingCreationReceipt) =>
      r.outcome === 'created' ? Object.freeze({ listingId: r.listingId, revision: 1 }) : null,
    restored,
  );
}
function successor(
  client: ListingSuccessorClient,
  storage: ReturnType<typeof successorAllocationSession>,
  command: ListingSuccessorCommand,
  restored: boolean,
) {
  return attempt(
    client,
    storage,
    command,
    validateListingSuccessorCommand,
    validateListingSuccessorReceipt,
    (r: ListingSuccessorReceipt) =>
      r.decision.outcome === 'applied'
        ? Object.freeze({ listingId: r.listingId, revision: r.decision.result.revision })
        : null,
    restored,
  );
}
/** Purely local restoration; never allocate a listing/operation ID or dispatch a request. */
export function restoreCreationAllocation(
  client: ListingCreationClient,
  storage: ReturnType<typeof creationAllocationSession>,
) {
  const c = storage.load();
  return c ? creation(client, storage, c, true) : null;
}
export function restoreSuccessorAllocation(
  client: ListingSuccessorClient,
  storage: ReturnType<typeof successorAllocationSession>,
) {
  const c = storage.load();
  return c ? successor(client, storage, c, true) : null;
}
export function prepareCreationAllocation(
  client: ListingCreationClient,
  storage: ReturnType<typeof creationAllocationSession>,
  command: ListingCreationCommand,
) {
  if (storage.load() !== null) return fail();
  return creation(client, storage, storage.capture(command), false);
}
export function prepareSuccessorAllocation(
  client: ListingSuccessorClient,
  storage: ReturnType<typeof successorAllocationSession>,
  command: ListingSuccessorCommand,
) {
  if (storage.load() !== null) return fail();
  return successor(client, storage, storage.capture(command), false);
}

export function openCreationAllocation(
  client: ListingCreationClient,
  store: Store,
  identity: AllocationIdentity,
) {
  const storage = creationAllocationSession(store, identity),
    restored = restoreCreationAllocation(client, storage);
  return Object.freeze({
    storage,
    restored,
    prepare(
      input: Pick<ListingCreationCommand, 'slug' | 'content'>,
      newListingId: () => string,
      newOperationId: () => string,
    ) {
      if (restored || storage.load() !== null) return fail();
      const facts = own(input, ['slug', 'content']);
      return prepareCreationAllocation(
        client,
        storage,
        validateListingCreationCommand({
          listingId: newListingId(),
          operationId: newOperationId(),
          ...facts,
        }),
      );
    },
  });
}
/** Current draft state must not hide an original whose earlier successor POST committed. */
export function openSuccessorAllocation(
  client: ListingSuccessorClient,
  store: Store,
  identity: AllocationIdentity,
  listingId: string,
  listingInput: StaffListingSummary,
) {
  const storage = successorAllocationSession(store, identity, listingId);
  const listing = validateStaffListingSummary(listingInput, listingId),
    restored = restoreSuccessorAllocation(client, storage),
    latest = listing.latest;
  const predecessor =
    latest && (latest.state === 'approved' || latest.state === 'rejected')
      ? Object.freeze({ revision: latest.revision, version: latest.version, state: latest.state })
      : null;
  return Object.freeze({
    storage,
    restored,
    eligible: restored === null && predecessor !== null,
    prepare(content: ListingSuccessorCommand['content'], newOperationId: () => string) {
      if (restored || !predecessor || storage.load() !== null) return fail();
      return prepareSuccessorAllocation(
        client,
        storage,
        validateListingSuccessorCommand({
          listingId,
          operationId: newOperationId(),
          expectedListingVersion: listing.version,
          predecessor,
          content,
        }),
      );
    },
  });
}
