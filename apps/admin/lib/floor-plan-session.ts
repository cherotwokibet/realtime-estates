import { ApiClientError } from '@realtor/api-client';
import {
  validateFloorPlanPreparationCommand,
  validatePreparedFloorPlan,
  validateFloorPlanAttachmentCommand,
  validateFloorPlanAttachmentRecord,
  type FloorPlanPreparationCommand,
  type PreparedFloorPlan,
  type FloorPlanAttachmentCommand,
  type FloorPlanAttachmentRecord,
} from '@realtor/domain';
import {
  captureVideoScope,
  videoSession,
  type VideoScope,
  type VideoStore,
} from './listing-video-session.ts';
import { referenceDraftSession } from './reference-draft-workspace.ts';
import { referenceModerationSession } from './reference-moderation-workspace.ts';
import { parseVerificationJson } from './listing-verification-wire.ts';
import { floorPlanOriginalKey } from './floor-plan-original-key.ts';
export type FloorPlanCommand = FloorPlanPreparationCommand | FloorPlanAttachmentCommand;
export type FloorPlanReceipt = PreparedFloorPlan | FloorPlanAttachmentRecord;
export interface FloorPlanClient {
  prepare(
    c: FloorPlanPreparationCommand,
    source: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PreparedFloorPlan>;
  recoverPreparation(
    c: FloorPlanPreparationCommand,
    signal?: AbortSignal,
  ): Promise<PreparedFloorPlan>;
  attach(c: FloorPlanAttachmentCommand, signal?: AbortSignal): Promise<FloorPlanAttachmentRecord>;
  recoverAttachment(
    c: FloorPlanAttachmentCommand,
    signal?: AbortSignal,
  ): Promise<FloorPlanAttachmentRecord>;
}
type Outcome = 'uncertain' | 'resolved' | 'refused';
interface Original {
  readonly schema: 'floor-plan-original-v1';
  readonly scope: VideoScope;
  readonly command: FloorPlanCommand;
  readonly outcome: Outcome;
  readonly receipt: FloorPlanReceipt | null;
}
const fail = (): never => {
  throw Error('Keep the original floor-plan request.');
};
const exact = (value: unknown, keys: readonly string[]) => {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail();
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    result[k] = d.value;
  }
  return result;
};
const command = (v: unknown): FloorPlanCommand => {
  if (!v || typeof v !== 'object') return fail();
  const d = Object.getOwnPropertyDescriptor(v, 'policy');
  if (!d || !Object.hasOwn(d, 'value')) return fail();
  return d.value === 'synthetic-floor-plan-preparation-command-v1'
    ? validateFloorPlanPreparationCommand(v)
    : validateFloorPlanAttachmentCommand(v);
};
function receipt(value: unknown, c: FloorPlanCommand, actorId: string): FloorPlanReceipt {
  if (c.policy === 'synthetic-floor-plan-preparation-command-v1')
    return validatePreparedFloorPlan(value, c);
  const r = validateFloorPlanAttachmentRecord(value, c);
  if (r.actorId !== actorId) return fail();
  return r;
}
export function assertFloorPlanOtherOriginalsClear(store: VideoStore, input: VideoScope) {
  const scope = captureVideoScope(input),
    { revision, ...draft } = scope;
  if (
    videoSession(store, scope).load() !== null ||
    referenceDraftSession(store, draft).load() !== null ||
    referenceModerationSession(store, scope, 'author').load() !== null ||
    referenceModerationSession(store, scope, 'review').load() !== null
  )
    throw Error('Finish retained video, draft or transition originals first.');
}
export function floorPlanSession(store: VideoStore, input: VideoScope) {
  const scope = captureVideoScope(input),
    key = floorPlanOriginalKey(scope.instanceId, scope.listingId);
  function decode(raw: string): Original {
    if (new TextEncoder().encode(raw).length > 8192) return fail();
    const v = exact(parseVerificationJson(raw), [
      'schema',
      'scope',
      'command',
      'outcome',
      'receipt',
    ]);
    if (
      v.schema !== 'floor-plan-original-v1' ||
      JSON.stringify(captureVideoScope(v.scope as VideoScope)) !== JSON.stringify(scope) ||
      !['uncertain', 'resolved', 'refused'].includes(v.outcome as string)
    )
      return fail();
    const c = command(v.command);
    if (c.listingId !== scope.listingId || c.revision !== scope.revision) return fail();
    const r = v.outcome === 'resolved' ? receipt(v.receipt, c, scope.actorId) : null;
    if (v.outcome !== 'resolved' && v.receipt !== null) return fail();
    return Object.freeze({
      schema: 'floor-plan-original-v1',
      scope,
      command: c,
      outcome: v.outcome as Outcome,
      receipt: r,
    });
  }
  function compare(expected: Original | null) {
    const raw = store.getItem(key);
    if (
      expected === null
        ? raw !== null
        : raw === null || JSON.stringify(decode(raw)) !== JSON.stringify(expected)
    )
      return fail();
  }
  function write(
    expected: Original | null,
    c: FloorPlanCommand,
    outcome: Outcome,
    r: FloorPlanReceipt | null,
  ) {
    compare(expected);
    const raw = JSON.stringify({
        schema: 'floor-plan-original-v1',
        scope,
        command: c,
        outcome,
        receipt: r,
      }),
      result = decode(raw);
    store.setItem(key, raw);
    if (store.getItem(key) !== raw) return fail();
    return result;
  }
  return Object.freeze({
    scope,
    load() {
      const raw = store.getItem(key);
      return raw === null ? null : decode(raw);
    },
    verify: compare,
    retain(c: FloorPlanCommand) {
      return write(null, command(c), 'uncertain', null);
    },
    outcome(expected: Original, value: Outcome, r: FloorPlanReceipt | null) {
      return write(expected, expected.command, value, r);
    },
    handoff(expected: Original, input: FloorPlanAttachmentCommand) {
      const c = validateFloorPlanAttachmentCommand(input),
        p = expected.command;
      if (
        expected.outcome !== 'resolved' ||
        p.policy !== 'synthetic-floor-plan-preparation-command-v1' ||
        expected.receipt?.policy !== 'synthetic-floor-plan-prepared-v1' ||
        c.requestId !== p.requestId ||
        c.expectedVersion !== p.expectedVersion ||
        c.listingId !== p.listingId ||
        c.revision !== p.revision
      )
        return fail();
      return write(expected, c, 'uncertain', null);
    },
    clear(expected: Original) {
      compare(expected);
      store.removeItem(key);
      if (store.getItem(key) !== null) return fail();
    },
  });
}
export function floorPlanAttempt(
  store: VideoStore,
  input: VideoScope,
  client: FloorPlanClient,
  value: FloorPlanCommand,
  restore = false,
) {
  const session = floorPlanSession(store, input),
    c = command(value);
  let original = session.load();
  if (c.listingId !== session.scope.listingId || c.revision !== session.scope.revision)
    return fail();
  if (restore) {
    if (!original || JSON.stringify(original.command) !== JSON.stringify(c)) return fail();
  } else {
    assertFloorPlanOtherOriginalsClear(store, session.scope);
    if (original !== null) return fail();
    original = session.retain(c);
  }
  function attempt(initial: Original, prepared: boolean) {
    let saved = initial,
      status: 'prepared' | 'sending' | Outcome = prepared ? 'prepared' : initial.outcome,
      settled = initial.receipt,
      cleared = false;
    async function run(recover: boolean, source?: Uint8Array, signal?: AbortSignal) {
      if (cleared || (recover ? status !== 'uncertain' : status !== 'prepared')) return fail();
      if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Cancelled.');
      if (!recover) assertFloorPlanOtherOriginalsClear(store, session.scope);
      session.verify(saved);
      saved = session.outcome(saved, 'uncertain', null);
      status = 'sending';
      try {
        const c = saved.command;
        const result = receipt(
          await (c.policy === 'synthetic-floor-plan-preparation-command-v1'
            ? recover
              ? client.recoverPreparation(c, signal)
              : client.prepare(c, source!, signal)
            : recover
              ? client.recoverAttachment(c, signal)
              : client.attach(c, signal)),
          c,
          session.scope.actorId,
        );
        saved = session.outcome(saved, 'resolved', result);
        settled = result;
        status = 'resolved';
        return result;
      } catch (error) {
        status = 'uncertain';
        if (
          !recover &&
          error instanceof ApiClientError &&
          error.kind === 'HTTP' &&
          error.status &&
          error.status >= 400 &&
          error.status < 500 &&
          !error.submissionUncertain
        ) {
          saved = session.outcome(saved, 'refused', null);
          status = 'refused';
        }
        throw error;
      }
    }
    return Object.freeze({
      command: initial.command,
      get status() {
        return status;
      },
      get receipt() {
        return settled;
      },
      send: (source?: Uint8Array, signal?: AbortSignal) => run(false, source, signal),
      recover: (signal?: AbortSignal) => run(true, undefined, signal),
      handoff(c: FloorPlanAttachmentCommand) {
        if (cleared || status !== 'resolved') return fail();
        assertFloorPlanOtherOriginalsClear(store, session.scope);
        const next = session.handoff(saved, c);
        cleared = true;
        return attempt(next, true);
      },
      clear() {
        if (cleared || status === 'sending' || status === 'uncertain') return fail();
        session.clear(saved);
        cleared = true;
      },
    });
  }
  return attempt(original!, !restore);
}
