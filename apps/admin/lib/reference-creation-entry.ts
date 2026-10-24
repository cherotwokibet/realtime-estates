import { ApiClientError } from '@realtor/api-client';
import { parseVerificationJson } from './listing-verification-wire.ts';
import {
  referenceCreationSession,
  type ReferenceCreationAttempt,
} from './reference-creation-workspace.ts';
export interface CreationIdentity {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly actorId: string;
}
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const fail = (): never => {
  throw new ApiClientError('VALIDATION', 'Keep the retained creation and retry loading.');
};
const uuid = (value: unknown): string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : fail();
function own(value: unknown, fields: string[]): Record<string, unknown> {
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
/** One session-storage entry atomically contains the target and its complete original. */
export function openReferenceCreationEntry(
  store: Store,
  input: CreationIdentity,
  newListingId: () => string,
) {
  const rawIdentity = own(input, ['instanceId', 'tenantId', 'actorId']);
  const identity = Object.freeze({
    instanceId: uuid(rawIdentity.instanceId),
    tenantId: uuid(rawIdentity.tenantId),
    actorId: uuid(rawIdentity.actorId),
  });
  const key = `synthetic-reference-creation-workspace-v1:${identity.instanceId}:${identity.tenantId}:${identity.actorId}`;
  const bound = (raw: string) => {
    if (raw.length > 393216 || new TextEncoder().encode(raw).byteLength > 393216) return fail();
  };
  const decode = (raw: string) => {
    bound(raw);
    const row = own(parseVerificationJson(raw), [
      'schema',
      'instanceId',
      'tenantId',
      'actorId',
      'listingId',
      'original',
    ]);
    if (
      row.schema !== 'synthetic-reference-creation-entry-v1' ||
      Object.keys(identity).some((k) => row[k] !== identity[k as keyof CreationIdentity]) ||
      (row.original !== null && typeof row.original !== 'string')
    )
      return fail();
    return {
      schema: 'synthetic-reference-creation-entry-v1',
      ...identity,
      listingId: uuid(row.listingId),
      original: row.original as string | null,
    };
  };
  const write = (row: ReturnType<typeof decode>) => {
    const raw = JSON.stringify(row);
    bound(raw);
    store.setItem(key, raw);
    if (store.getItem(key) !== raw) return fail();
  };
  const saved = store.getItem(key);
  let entry: ReturnType<typeof decode>;
  if (saved === null) {
    entry = {
      schema: 'synthetic-reference-creation-entry-v1',
      ...identity,
      listingId: uuid(newListingId()),
      original: null,
    };
    write(entry);
  } else entry = decode(saved);
  const scope = Object.freeze({ ...identity, listingId: entry.listingId });
  const read = () => {
    const raw = store.getItem(key);
    if (raw === null) return fail();
    const row = decode(raw);
    if (row.listingId !== scope.listingId) return fail();
    return row;
  };
  const sessionKey = `synthetic-reference-creation-original-v1:${scope.instanceId}:${scope.tenantId}:${scope.actorId}:${scope.listingId}`;
  const session = referenceCreationSession(
    {
      getItem(k) {
        if (k !== sessionKey) return fail();
        return read().original;
      },
      setItem(k, value) {
        if (k !== sessionKey) return fail();
        write({ ...read(), original: value });
      },
      removeItem(k) {
        if (k !== sessionKey) return fail();
        write({ ...read(), original: null });
      },
    },
    scope,
  );
  // Reject malformed/misbound saved originals before exposing a fresh creation form.
  session.load();
  let released = false;
  return Object.freeze({
    scope,
    session,
    verifyReload(attempt: ReferenceCreationAttempt) {
      if (
        released ||
        attempt.status !== 'uncertain' ||
        attempt.original.listingId !== scope.listingId
      )
        return fail();
      session.verify(attempt.original);
    },
    release(attempt: ReferenceCreationAttempt) {
      if (released || !attempt.canDiscard || attempt.original.listingId !== scope.listingId)
        return fail();
      read();
      attempt.discard();
      if (read().original !== null) return fail();
      store.removeItem(key);
      if (store.getItem(key) !== null) return fail();
      released = true;
    },
  });
}
