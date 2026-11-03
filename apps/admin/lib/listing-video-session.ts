import { ApiClientError } from '@realtor/api-client';
import {
  validateListingVideoCommand,
  validateListingVideoRecord,
  type ListingVideoCommand,
  type ListingVideoRecord,
} from '@realtor/domain';
import { referenceDraftSession, type ReferenceDraftScope } from './reference-draft-workspace.ts';
import { referenceModerationSession } from './reference-moderation-workspace.ts';
import { captureAllocationIdentity } from './allocation-identity.ts';
import { parseVerificationJson } from './listing-verification-wire.ts';
export type VideoScope = ReferenceDraftScope & { readonly revision: number };
export interface VideoStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
export interface VideoClient {
  save(c: ListingVideoCommand, signal?: AbortSignal): Promise<ListingVideoRecord>;
  recover(c: ListingVideoCommand, signal?: AbortSignal): Promise<ListingVideoRecord>;
}
const fail = (): never => {
  throw Error('Keep the original private video request.');
};
export function captureVideoScope(input: VideoScope): VideoScope {
  if (
    !input ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 5
  )
    return fail();
  const out: Record<string, unknown> = {};
  for (const k of ['instanceId', 'tenantId', 'actorId', 'listingId', 'revision']) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    out[k] = d.value;
  }
  const identity = captureAllocationIdentity({
    instanceId: out.instanceId as string,
    tenantId: out.tenantId as string,
    actorId: out.actorId as string,
  });
  validateListingVideoCommand({
    policy: 'synthetic-listing-video-command-v1',
    operationId: out.listingId,
    listingId: out.listingId,
    revision: out.revision,
    expectedVersion: '1',
    video: null,
  });
  return Object.freeze({
    ...identity,
    listingId: out.listingId as string,
    revision: out.revision as number,
  });
}
const key = (instanceId: string, listingId: string) =>
  `synthetic-listing-video-original-v1:${instanceId}:${listingId}`;
/** Any retained video entry locks new preparation; malformed or foreign entries are never erased. */
export function assertListingVideoClear(store: VideoStore, instanceId: string, listingId: string) {
  if (store.getItem(key(instanceId, listingId)) !== null)
    throw Error('Finish the retained private video original first.');
}
export function videoSession(store: VideoStore, input: VideoScope) {
  const scope = captureVideoScope(input),
    k = key(scope.instanceId, scope.listingId);
  type Saved = {
    schema: 'private-listing-video-original-v1';
    scope: VideoScope;
    command: ListingVideoCommand;
    outcome: 'uncertain' | 'resolved' | 'refused';
    receipt: ListingVideoRecord | null;
  };
  function decode(raw: string): Saved {
    if (new TextEncoder().encode(raw).byteLength > 8192) return fail();
    const r = parseVerificationJson(raw) as Saved;
    if (
      !r ||
      Object.keys(r).sort().join(',') !== 'command,outcome,receipt,schema,scope' ||
      r.schema !== 'private-listing-video-original-v1' ||
      JSON.stringify(captureVideoScope(r.scope)) !== JSON.stringify(scope)
    )
      return fail();
    const command = validateListingVideoCommand(r.command);
    if (
      command.listingId !== scope.listingId ||
      command.revision !== scope.revision ||
      !['uncertain', 'resolved', 'refused'].includes(r.outcome)
    )
      return fail();
    const receipt =
      r.outcome === 'resolved' ? validateListingVideoRecord(r.receipt, command) : null;
    if (receipt?.actorId !== undefined && receipt.actorId !== scope.actorId) return fail();
    if (r.outcome !== 'resolved' && r.receipt !== null) return fail();
    return { schema: r.schema, scope, command, outcome: r.outcome, receipt };
  }
  function write(
    command: ListingVideoCommand,
    outcome: Saved['outcome'],
    receipt: ListingVideoRecord | null,
  ) {
    const prior = store.getItem(k);
    if (prior !== null && JSON.stringify(decode(prior).command) !== JSON.stringify(command))
      return fail();
    const raw = JSON.stringify({
      schema: 'private-listing-video-original-v1',
      scope,
      command,
      outcome,
      receipt,
    });
    decode(raw);
    store.setItem(k, raw);
    if (store.getItem(k) !== raw) return fail();
  }
  return Object.freeze({
    scope,
    load() {
      const raw = store.getItem(k);
      return raw === null ? null : decode(raw);
    },
    retain(command: ListingVideoCommand) {
      if (store.getItem(k) !== null) return fail();
      write(command, 'uncertain', null);
    },
    verify(command: ListingVideoCommand) {
      const raw = store.getItem(k);
      if (raw === null || JSON.stringify(decode(raw).command) !== JSON.stringify(command))
        return fail();
    },
    outcome: write,
    clear(command: ListingVideoCommand) {
      const raw = store.getItem(k);
      if (raw === null || JSON.stringify(decode(raw).command) !== JSON.stringify(command))
        return fail();
      store.removeItem(k);
      if (store.getItem(k) !== null) return fail();
    },
  });
}
export function assertVideoOtherOriginalsClear(store: VideoStore, scope: VideoScope) {
  const { revision, ...draftScope } = scope;
  if (
    referenceDraftSession(store, draftScope).load() !== null ||
    referenceModerationSession(store, scope, 'author').load() !== null ||
    referenceModerationSession(store, scope, 'review').load() !== null
  )
    throw Error('Finish the retained draft or transition original first.');
}
export function videoAttempt(
  store: VideoStore,
  scope: VideoScope,
  client: VideoClient,
  input: ListingVideoCommand,
  restore = false,
) {
  const session = videoSession(store, scope),
    command = validateListingVideoCommand(input),
    saved = session.load();
  if (command.listingId !== scope.listingId || command.revision !== scope.revision) return fail();
  if (!restore) {
    assertVideoOtherOriginalsClear(store, scope);
    if (saved !== null) return fail();
    session.retain(command);
  } else {
    session.verify(command);
  }
  let status: 'prepared' | 'sending' | 'uncertain' | 'resolved' | 'refused' = restore
      ? saved!.outcome
      : 'prepared',
    receipt = restore ? saved!.receipt : null,
    cleared = false;
  async function run(recover: boolean, replay = false, signal?: AbortSignal) {
    if (cleared || (recover || replay ? status !== 'uncertain' : status !== 'prepared'))
      return fail();
    if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Cancelled.');
    if (!recover) assertVideoOtherOriginalsClear(store, scope);
    session.verify(command);
    session.outcome(command, 'uncertain', null);
    status = 'sending';
    try {
      const value = validateListingVideoRecord(
        await (recover ? client.recover(command, signal) : client.save(command, signal)),
        command,
      );
      if (value.actorId !== scope.actorId) return fail();
      session.verify(command);
      session.outcome(command, 'resolved', value);
      receipt = value;
      status = 'resolved';
      return value;
    } catch (e) {
      status = 'uncertain';
      if (
        !recover &&
        !replay &&
        e instanceof ApiClientError &&
        e.kind === 'HTTP' &&
        e.status &&
        e.status >= 400 &&
        e.status < 500 &&
        !e.submissionUncertain
      ) {
        session.outcome(command, 'refused', null);
        status = 'refused';
      }
      throw e;
    }
  }
  return Object.freeze({
    command,
    get status() {
      return status;
    },
    get receipt() {
      return receipt;
    },
    send: (s?: AbortSignal) => run(false, false, s),
    recover: (s?: AbortSignal) => run(true, false, s),
    replay: (s?: AbortSignal) => run(false, true, s),
    clear() {
      if (cleared || status === 'sending' || status === 'uncertain') return fail();
      session.clear(command);
      cleared = true;
    },
  });
}
