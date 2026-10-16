import { Buffer } from 'node:buffer';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isSharedArrayBuffer } from 'node:util/types';
import {
  DurableStoreError,
  type DurableSyntheticReference,
  type DurableSyntheticStore,
} from './durable-store.js';
import type { WindowsSyntheticOutcome } from './windows-supervisor.js';

export interface SyntheticAttemptBinding {
  readonly jobId: string;
  readonly claimId: string;
  readonly attempt: number;
  readonly leaseNonce: string;
}
export interface SyntheticAttemptIntent extends SyntheticAttemptBinding {
  readonly version: 1;
  readonly journalId: string;
  readonly attemptDirectory: string;
}
export interface SyntheticAttemptTerminal extends SyntheticAttemptIntent {
  readonly outcome: WindowsSyntheticOutcome;
}
declare const syntheticAttemptTicket: unique symbol;
export interface SyntheticAttemptTicket {
  readonly kind: 'synthetic_attempt';
  readonly [syntheticAttemptTicket]: true;
}
export interface SyntheticAttemptReservation {
  readonly ticket: SyntheticAttemptTicket;
  readonly intent: SyntheticAttemptIntent;
}
export type SyntheticAttemptInspection =
  | Readonly<{
      state: 'blocked';
      reason: 'UNCONFIRMED' | 'CONTAINMENT_UNKNOWN';
      intent: SyntheticAttemptIntent | null;
      terminal: SyntheticAttemptTerminal | null;
    }>
  | Readonly<{
      state: 'termination_recorded';
      reason: null;
      intent: SyntheticAttemptIntent;
      terminal: SyntheticAttemptTerminal;
    }>;
export interface SyntheticAttemptJournal {
  readonly journalId: string;
  readonly rootDirectory: string;
  readonly attemptParent: string;
  reserve(binding: SyntheticAttemptBinding): Promise<SyntheticAttemptReservation>;
  /** Consumes one fresh live ticket. Historical inspection never recreates it. */
  consumeLaunchTicket(ticket: SyntheticAttemptTicket): SyntheticAttemptIntent;
  recordTermination(
    ticket: SyntheticAttemptTicket,
    outcome: WindowsSyntheticOutcome,
  ): Promise<SyntheticAttemptTerminal>;
  /** An immutable recorded observation only; never launch, cleanup, read or promotion authority. */
  inspect(binding: SyntheticAttemptBinding): Promise<SyntheticAttemptInspection>;
  close(): Promise<void>;
}
export interface SyntheticAttemptJournalConfiguration {
  readonly store: DurableSyntheticStore;
  readonly attemptParent: string;
}
export type SyntheticAttemptJournalErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_BINDING'
  | 'INVALID_TICKET'
  | 'INVALID_OUTCOME'
  | 'BUSY'
  | 'CLOSED'
  | 'BLOCKED'
  | 'INTEGRITY'
  | 'PERSISTENCE_FAILED';
export class SyntheticAttemptJournalError extends Error {
  override readonly name = 'SyntheticAttemptJournalError';
  constructor(readonly code: SyntheticAttemptJournalErrorCode) {
    super(`Synthetic attempt journal: ${code}.`);
  }
}
interface Identity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
}
interface Directory {
  readonly location: string;
  readonly identity: Identity;
}
interface LiveTicket {
  readonly intent: SyntheticAttemptIntent;
  readonly directory: Directory;
}
const LIMIT = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_KEYS = ['jobId', 'claimId', 'attempt', 'leaseNonce'] as const;
const INTENT_KEYS = ['version', 'journalId', ...BINDING_KEYS, 'attemptDirectory'] as const;
function fail(code: SyntheticAttemptJournalErrorCode): never {
  throw new SyntheticAttemptJournalError(code);
}
function mapped(error: unknown): SyntheticAttemptJournalError {
  if (error instanceof SyntheticAttemptJournalError) return error;
  if (error instanceof DurableStoreError) {
    if (
      error.code === 'INTEGRITY' ||
      error.code === 'INVALID_PARENT' ||
      error.code === 'INVALID_REFERENCE'
    )
      return new SyntheticAttemptJournalError('INTEGRITY');
    if (error.code === 'CONFLICT' || error.code === 'INCOMPLETE')
      return new SyntheticAttemptJournalError('BLOCKED');
  }
  return new SyntheticAttemptJournalError('PERSISTENCE_FAILED');
}
function nativeCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
function plain(
  value: unknown,
  keys: readonly string[],
  code: SyntheticAttemptJournalErrorCode,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    return fail(code);
  const own = Reflect.ownKeys(value),
    result: Record<string, unknown> = {};
  if (own.length !== keys.length) return fail(code);
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) return fail(code);
    const item = Object.getOwnPropertyDescriptor(value, key);
    if (!item?.enumerable || !Object.hasOwn(item, 'value')) return fail(code);
    result[key] = item.value;
  }
  return result;
}
function uuid(value: unknown, code: SyntheticAttemptJournalErrorCode): string {
  if (typeof value !== 'string' || !UUID.test(value)) return fail(code);
  return value.toLowerCase();
}
function binding(
  value: unknown,
  code: SyntheticAttemptJournalErrorCode = 'INVALID_BINDING',
): SyntheticAttemptBinding {
  try {
    const row = plain(value, BINDING_KEYS, code);
    if (
      typeof row.attempt !== 'number' ||
      !Number.isSafeInteger(row.attempt) ||
      row.attempt < 1 ||
      row.attempt > 3
    )
      return fail(code);
    return Object.freeze({
      jobId: uuid(row.jobId, code),
      claimId: uuid(row.claimId, code),
      attempt: row.attempt,
      leaseNonce: uuid(row.leaseNonce, code),
    });
  } catch (error) {
    if (error instanceof SyntheticAttemptJournalError) throw error;
    return fail(code);
  }
}
function outcome(value: unknown, code: SyntheticAttemptJournalErrorCode): WindowsSyntheticOutcome {
  try {
    const descriptor =
      value && typeof value === 'object'
        ? Object.getOwnPropertyDescriptor(value, 'state')
        : undefined;
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail(code);
    const unknown = descriptor.value === 'containment_unknown';
    const row = plain(
      value,
      unknown
        ? ['state', 'termination', 'cleanupAllowed', 'safeCode']
        : ['state', 'termination', 'exitCode', 'activeProcesses', 'safeCode'],
      code,
    );
    if (typeof row.safeCode !== 'string' || !/^[A-Z_]{1,64}$/.test(row.safeCode)) return fail(code);
    if (unknown) {
      if (row.termination !== 'unconfirmed' || row.cleanupAllowed !== false) return fail(code);
      return Object.freeze({
        state: 'containment_unknown',
        termination: 'unconfirmed',
        cleanupAllowed: false,
        safeCode: row.safeCode,
      });
    }
    const isExit =
      typeof row.exitCode === 'number' &&
      Number.isInteger(row.exitCode) &&
      row.exitCode >= 0 &&
      row.exitCode <= 0xffffffff;
    if (
      typeof row.state !== 'string' ||
      !['exited', 'failed', 'timed_out', 'cancelled'].includes(row.state) ||
      row.termination !== 'job_empty' ||
      row.activeProcesses !== 0 ||
      (row.exitCode !== null && !isExit) ||
      (row.state === 'exited' && !isExit)
    )
      return fail(code);
    return Object.freeze({
      state: row.state as 'exited' | 'failed' | 'timed_out' | 'cancelled',
      termination: 'job_empty',
      exitCode: row.exitCode as number | null,
      activeProcesses: 0,
      safeCode: row.safeCode,
    });
  } catch (error) {
    if (error instanceof SyntheticAttemptJournalError) throw error;
    return fail(code);
  }
}
function absolute(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !path.isAbsolute(value) ||
    (process.platform === 'win32' && path.parse(value).root.startsWith('\\\\'))
  )
    return fail('INVALID_CONFIGURATION');
  return path.resolve(value);
}
function equalPath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function contained(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
function identity(stat: BigIntStats): Identity {
  return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
}
function sameIdentity(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
async function directory(location: string, expected?: Identity): Promise<Directory> {
  let stat: BigIntStats;
  try {
    stat = await lstat(location, { bigint: true });
  } catch (error) {
    if (nativeCode(error) === 'ENOENT') return fail('INTEGRITY');
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (expected && !sameIdentity(identity(stat), expected)) ||
    !equalPath(path.resolve(await realpath(location)), location)
  )
    return fail('INTEGRITY');
  return { location, identity: identity(stat) };
}
async function ancestors(location: string): Promise<Directory[]> {
  const result: Directory[] = [];
  for (;;) {
    result.push(await directory(location));
    const previous = path.dirname(location);
    if (previous === location) return result;
    location = previous;
  }
}
async function guard(directories: readonly Directory[]): Promise<void> {
  for (const item of directories) await directory(item.location, item.identity);
}
function encoded(value: unknown, code: SyntheticAttemptJournalErrorCode): Buffer {
  const result = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  if (result.length > LIMIT) return fail(code);
  return result;
}
function parsed(bytes: unknown): unknown {
  if (
    !Buffer.isBuffer(bytes) ||
    isSharedArrayBuffer(bytes.buffer) ||
    bytes.length < 1 ||
    bytes.length > LIMIT
  )
    return fail('INTEGRITY');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes)));
  } catch {
    return fail('INTEGRITY');
  }
}
function intentFor(
  journalId: string,
  attemptParent: string,
  value: SyntheticAttemptBinding,
): SyntheticAttemptIntent {
  return Object.freeze({
    version: 1,
    journalId,
    jobId: value.jobId,
    claimId: value.claimId,
    attempt: value.attempt,
    leaseNonce: value.leaseNonce,
    attemptDirectory: path.join(attemptParent, value.jobId),
  });
}
function parseIntent(bytes: Buffer, expected: SyntheticAttemptIntent): SyntheticAttemptIntent {
  const row = plain(parsed(bytes), INTENT_KEYS, 'INTEGRITY');
  const found = binding(
    { jobId: row.jobId, claimId: row.claimId, attempt: row.attempt, leaseNonce: row.leaseNonce },
    'INTEGRITY',
  );
  const result = Object.freeze({
    version: 1 as const,
    journalId: uuid(row.journalId, 'INTEGRITY'),
    jobId: found.jobId,
    claimId: found.claimId,
    attempt: found.attempt,
    leaseNonce: found.leaseNonce,
    attemptDirectory: row.attemptDirectory,
  });
  if (
    row.version !== 1 ||
    typeof row.attemptDirectory !== 'string' ||
    !bytes.equals(encoded(result, 'INTEGRITY')) ||
    !bytes.equals(encoded(expected, 'INTEGRITY'))
  )
    return fail('INTEGRITY');
  return expected;
}
function parseTerminal(bytes: Buffer, expected: SyntheticAttemptIntent): SyntheticAttemptTerminal {
  const row = plain(parsed(bytes), [...INTENT_KEYS, 'outcome'], 'INTEGRITY');
  const rawIntent = {
    version: row.version,
    journalId: row.journalId,
    jobId: row.jobId,
    claimId: row.claimId,
    attempt: row.attempt,
    leaseNonce: row.leaseNonce,
    attemptDirectory: row.attemptDirectory,
  };
  parseIntent(encoded(rawIntent, 'INTEGRITY'), expected);
  const terminal = Object.freeze({ ...expected, outcome: outcome(row.outcome, 'INTEGRITY') });
  if (!bytes.equals(encoded(terminal, 'INTEGRITY'))) return fail('INTEGRITY');
  return terminal;
}
function ref(
  value: SyntheticAttemptBinding,
  kind: DurableSyntheticReference['kind'],
): DurableSyntheticReference {
  return Object.freeze({
    jobId: value.jobId,
    objectId: value.claimId,
    generationId: value.leaseNonce,
    kind,
  });
}

/**
 * Dedicated stable local journal only. A persisted terminal records an observation;
 * it never supplies launch, cleanup, promotion or historical filesystem provenance.
 * Unknown history must not be evaded by rotating this trusted configuration.
 */
export async function createSyntheticAttemptJournal(
  configuration: SyntheticAttemptJournalConfiguration,
): Promise<SyntheticAttemptJournal> {
  let storage: DurableSyntheticStore,
    journalId: string,
    rootDirectory: string,
    attemptParent: string,
    directories: Directory[];
  try {
    const config = plain(configuration, ['store', 'attemptParent'], 'INVALID_CONFIGURATION');
    const stored = plain(
      config.store,
      ['storeId', 'rootDirectory', 'install', 'read', 'close'],
      'INVALID_CONFIGURATION',
    );
    if (
      typeof stored.install !== 'function' ||
      typeof stored.read !== 'function' ||
      typeof stored.close !== 'function'
    )
      fail('INVALID_CONFIGURATION');
    storage = config.store as DurableSyntheticStore;
    journalId = uuid(stored.storeId, 'INVALID_CONFIGURATION');
    rootDirectory = absolute(stored.rootDirectory);
    attemptParent = absolute(config.attemptParent);
    if (contained(rootDirectory, attemptParent) || contained(attemptParent, rootDirectory))
      fail('INVALID_CONFIGURATION');
    directories = [
      ...(await ancestors(rootDirectory)),
      await directory(path.join(rootDirectory, 'objects')),
      ...(await ancestors(attemptParent)),
    ];
    await guard(directories);
  } catch {
    return fail('INVALID_CONFIGURATION');
  }
  const tickets = new WeakMap<SyntheticAttemptTicket, LiveTicket>(),
    consumed = new WeakSet<SyntheticAttemptTicket>(),
    observed = new WeakSet<SyntheticAttemptTicket>();
  let busy = false,
    closing = false,
    tail: Promise<void> = Promise.resolve(),
    closed: Promise<void> | undefined;
  function admitted<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new SyntheticAttemptJournalError('CLOSED'));
    if (busy) return Promise.reject(new SyntheticAttemptJournalError('BUSY'));
    busy = true;
    const work = (async () => {
      try {
        await guard(directories);
        return await operation();
      } catch (error) {
        throw mapped(error);
      } finally {
        busy = false;
      }
    })();
    tail = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
  async function readIntent(
    expected: SyntheticAttemptIntent,
  ): Promise<SyntheticAttemptIntent | null> {
    try {
      return parseIntent((await storage.read(ref(expected, 'quarantine'))).data, expected);
    } catch (error) {
      if (error instanceof DurableStoreError && error.code === 'INCOMPLETE') return null;
      throw error;
    }
  }
  async function exclusive(location: string): Promise<Directory> {
    try {
      await mkdir(location, { mode: 0o700, recursive: false });
    } catch (error) {
      if (nativeCode(error) === 'EEXIST') return fail('BLOCKED');
      throw error;
    }
    return directory(location);
  }
  function reserve(value: SyntheticAttemptBinding): Promise<SyntheticAttemptReservation> {
    let expected: SyntheticAttemptIntent, intentBytes: Buffer;
    try {
      expected = intentFor(journalId, attemptParent, binding(value));
      intentBytes = encoded(expected, 'INVALID_CONFIGURATION');
    } catch (error) {
      return Promise.reject(mapped(error));
    }
    return admitted(async () => {
      const old = await readIntent(expected);
      await guard(directories);
      if (old) fail('BLOCKED');
      // This journal alone owns the documented durable-store job directory.
      // EEXIST blocks even an empty reservation or deleted native attempt path.
      const job = await exclusive(path.join(rootDirectory, 'objects', expected.jobId));
      await guard([...directories, job]);
      const attemptDirectory = await exclusive(expected.attemptDirectory);
      await guard([...directories, job, attemptDirectory]);
      await storage.install(ref(expected, 'quarantine'), intentBytes);
      const committed = await readIntent(expected);
      if (!committed) fail('PERSISTENCE_FAILED');
      await guard([...directories, job, attemptDirectory]);
      const ticket = Object.freeze({ kind: 'synthetic_attempt' }) as SyntheticAttemptTicket;
      tickets.set(ticket, { intent: committed, directory: attemptDirectory });
      return Object.freeze({ ticket, intent: committed });
    });
  }
  function consumeLaunchTicket(ticket: SyntheticAttemptTicket): SyntheticAttemptIntent {
    if (closing) fail('CLOSED');
    if (busy) fail('BUSY');
    const live = ticket && typeof ticket === 'object' ? tickets.get(ticket) : undefined;
    if (!live || consumed.has(ticket) || observed.has(ticket)) fail('INVALID_TICKET');
    consumed.add(ticket);
    return live.intent;
  }
  function recordTermination(
    ticket: SyntheticAttemptTicket,
    value: WindowsSyntheticOutcome,
  ): Promise<SyntheticAttemptTerminal> {
    let live: LiveTicket, terminal: SyntheticAttemptTerminal, terminalBytes: Buffer;
    try {
      const found = ticket && typeof ticket === 'object' ? tickets.get(ticket) : undefined;
      if (!found) fail('INVALID_TICKET');
      live = found;
      terminal = Object.freeze({ ...live.intent, outcome: outcome(value, 'INVALID_OUTCOME') });
      terminalBytes = encoded(terminal, 'INVALID_OUTCOME');
    } catch (error) {
      return Promise.reject(mapped(error));
    }
    observed.add(ticket);
    return admitted(async () => {
      await guard([...directories, live.directory]);
      const committed = await readIntent(live.intent);
      if (!committed) fail('INTEGRITY');
      await storage.install(ref(live.intent, 'output'), terminalBytes);
      const read = await storage.read(ref(live.intent, 'output')),
        result = parseTerminal(read.data, live.intent);
      if (!read.data.equals(terminalBytes)) fail('BLOCKED');
      await guard([...directories, live.directory]);
      return result;
    });
  }
  function inspect(value: SyntheticAttemptBinding): Promise<SyntheticAttemptInspection> {
    let expected: SyntheticAttemptIntent;
    try {
      expected = intentFor(journalId, attemptParent, binding(value));
      encoded(expected, 'INVALID_CONFIGURATION');
    } catch (error) {
      return Promise.reject(mapped(error));
    }
    return admitted(async () => {
      const intent = await readIntent(expected);
      if (!intent) {
        await guard(directories);
        return Object.freeze({
          state: 'blocked',
          reason: 'UNCONFIRMED',
          intent: null,
          terminal: null,
        });
      }
      const current = await directory(intent.attemptDirectory);
      await guard([...directories, current]);
      let terminal: SyntheticAttemptTerminal;
      try {
        terminal = parseTerminal((await storage.read(ref(expected, 'output'))).data, intent);
      } catch (error) {
        if (error instanceof DurableStoreError && error.code === 'INCOMPLETE') {
          await guard([...directories, current]);
          return Object.freeze({ state: 'blocked', reason: 'UNCONFIRMED', intent, terminal: null });
        }
        throw error;
      }
      await guard([...directories, current]);
      if (terminal.outcome.state === 'containment_unknown')
        return Object.freeze({ state: 'blocked', reason: 'CONTAINMENT_UNKNOWN', intent, terminal });
      return Object.freeze({ state: 'termination_recorded', reason: null, intent, terminal });
    });
  }
  function close(): Promise<void> {
    closing = true;
    closed ??= tail.then(async () => {
      try {
        await storage.close();
      } catch (error) {
        throw mapped(error);
      }
    });
    return closed;
  }
  return Object.freeze({
    journalId,
    rootDirectory,
    attemptParent,
    reserve,
    consumeLaunchTicket,
    recordTermination,
    inspect,
    close,
  });
}
