import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  SyntheticAttemptJournalError,
  type SyntheticAttemptIntent,
  type SyntheticAttemptJournal,
  type SyntheticAttemptReservation,
  type SyntheticAttemptTerminal,
  type SyntheticAttemptTicket,
} from './attempt-journal.js';
import type { WindowsSyntheticOutcome } from './windows-supervisor.js';

export interface SyntheticWorkerOwner {
  readonly version: 1;
  readonly workerId: string;
  readonly journalId: string;
  readonly jobId: string;
  readonly claimId: string;
  readonly reservationId: string;
}
declare const syntheticWorkerPermit: unique symbol;
export interface SyntheticWorkerPermit {
  readonly kind: 'synthetic_worker';
  readonly [syntheticWorkerPermit]: true;
}
export interface SyntheticWorkerReservation {
  readonly permit: SyntheticWorkerPermit;
  readonly owner: SyntheticWorkerOwner;
}
export type SyntheticWorkerCompletion =
  | Readonly<{ owner: SyntheticWorkerOwner; state: 'not_launched' }>
  | Readonly<{
      owner: SyntheticWorkerOwner;
      state: 'job_empty';
      terminal: SyntheticAttemptTerminal;
    }>;
export type SyntheticWorkerRetained = Readonly<{ state: 'blocked'; reason: 'CONTAINMENT_UNKNOWN' }>;
export type SyntheticWorkerInspection =
  | Readonly<{ state: 'idle'; owner: null }>
  | Readonly<{ state: 'blocked'; owner: SyntheticWorkerOwner | null }>;
export interface SyntheticWorkerAdmission {
  readonly rootDirectory: string;
  readonly workerId: string;
  readonly journalId: string;
  reserve(
    binding: Readonly<{ jobId: string; claimId: string }>,
  ): Promise<SyntheticWorkerReservation>;
  arm(permit: SyntheticWorkerPermit, reservation: SyntheticAttemptReservation): Promise<void>;
  releaseBeforeLaunch(
    permit: SyntheticWorkerPermit,
  ): Promise<Extract<SyntheticWorkerCompletion, { state: 'not_launched' }>>;
  confirmTermination(
    permit: SyntheticWorkerPermit,
    outcome: WindowsSyntheticOutcome,
  ): Promise<SyntheticWorkerCompletion | SyntheticWorkerRetained>;
  inspect(): Promise<SyntheticWorkerInspection>;
  /** Drains admission I/O only. The caller owns the journal and every retained slot. */
  close(): Promise<void>;
}
export interface SyntheticWorkerAdmissionConfiguration {
  readonly parentDirectory: string;
  readonly journal: SyntheticAttemptJournal;
}
export interface SyntheticWorkerAdmissionReopenConfiguration {
  readonly rootDirectory: string;
  readonly workerId: string;
  readonly journal: SyntheticAttemptJournal;
}
export type SyntheticWorkerAdmissionErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'INVALID_PERMIT'
  | 'INVALID_STATE'
  | 'BUSY'
  | 'CLOSED'
  | 'BLOCKED'
  | 'INTEGRITY'
  | 'PERSISTENCE_FAILED';
export class SyntheticWorkerAdmissionError extends Error {
  override readonly name = 'SyntheticWorkerAdmissionError';
  constructor(readonly code: SyntheticWorkerAdmissionErrorCode) {
    super(`Synthetic worker admission: ${code}.`);
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
interface FileSnapshot {
  readonly identity: Identity;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}
interface ScannedFile {
  readonly snapshot: FileSnapshot;
  readonly bytes: Buffer;
}
interface JournalConfiguration {
  readonly journal: SyntheticAttemptJournal;
  readonly journalId: string;
  readonly rootDirectory: string;
  readonly attemptParent: string;
}
interface LivePermit {
  readonly owner: SyntheticWorkerOwner;
  readonly directory: Directory;
  readonly ownerFile: FileSnapshot;
  phase: 'unarmed' | 'armed' | 'releasing' | 'released' | 'retained';
  ready: boolean;
  intent?: SyntheticAttemptIntent;
  ticket?: SyntheticAttemptTicket;
  outcome?: WindowsSyntheticOutcome;
}
const LIMIT = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_KEYS = [
  'version',
  'workerId',
  'journalId',
  'jobId',
  'claimId',
  'reservationId',
] as const;
const INTENT_KEYS = [
  'version',
  'journalId',
  'jobId',
  'claimId',
  'attempt',
  'leaseNonce',
  'attemptDirectory',
] as const;
const RECORDS = ['owner.json', 'launch.json', 'completion.json'] as const;
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const WRITE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
function fail(code: SyntheticWorkerAdmissionErrorCode): never {
  throw new SyntheticWorkerAdmissionError(code);
}
function mapped(error: unknown): SyntheticWorkerAdmissionError {
  if (error instanceof SyntheticWorkerAdmissionError) return error;
  if (error instanceof SyntheticAttemptJournalError) {
    if (error.code === 'INTEGRITY') return new SyntheticWorkerAdmissionError('INTEGRITY');
    if (error.code === 'BUSY') return new SyntheticWorkerAdmissionError('BUSY');
    if (error.code === 'BLOCKED') return new SyntheticWorkerAdmissionError('BLOCKED');
    if (
      error.code === 'INVALID_TICKET' ||
      error.code === 'INVALID_BINDING' ||
      error.code === 'CLOSED'
    )
      return new SyntheticWorkerAdmissionError('INVALID_STATE');
  }
  return new SyntheticWorkerAdmissionError('PERSISTENCE_FAILED');
}
function nativeCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
function plain(
  value: unknown,
  keys: readonly string[],
  code: SyntheticWorkerAdmissionErrorCode,
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
function uuid(value: unknown, code: SyntheticWorkerAdmissionErrorCode): string {
  if (typeof value !== 'string' || !UUID.test(value)) return fail(code);
  return value.toLowerCase();
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
    const parent = path.dirname(location);
    if (parent === location) return result;
    location = parent;
  }
}
async function guardDirectories(directories: readonly Directory[]): Promise<void> {
  for (const item of directories) await directory(item.location, item.identity);
}
async function names(
  location: string,
  allowed: readonly string[],
  required: readonly string[] = [],
  directories: readonly string[] = [],
): Promise<readonly string[]> {
  const result: string[] = [],
    handle = await opendir(location);
  try {
    for (;;) {
      const item = await handle.read();
      if (!item) break;
      if (
        result.length >= allowed.length ||
        !allowed.includes(item.name) ||
        result.includes(item.name) ||
        item.isSymbolicLink() ||
        (directories.includes(item.name) ? !item.isDirectory() : !item.isFile())
      )
        fail('INTEGRITY');
      result.push(item.name);
    }
  } finally {
    await handle.close();
  }
  if (required.some((name) => !result.includes(name))) fail('INTEGRITY');
  return result;
}
function regular(stat: BigIntStats, expected?: Identity): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    (expected && !sameIdentity(identity(stat), expected))
  )
    fail('INTEGRITY');
}
async function guardFile(location: string, expected: FileSnapshot): Promise<void> {
  let stat: BigIntStats;
  try {
    stat = await lstat(location, { bigint: true });
  } catch (error) {
    if (nativeCode(error) === 'ENOENT') return fail('INTEGRITY');
    throw error;
  }
  regular(stat, expected.identity);
  if (stat.size !== expected.size || stat.mtimeNs !== expected.mtimeNs) fail('INTEGRITY');
}
async function scan(location: string, expected?: FileSnapshot): Promise<ScannedFile> {
  let initial: BigIntStats;
  try {
    initial = await lstat(location, { bigint: true });
  } catch (error) {
    if (nativeCode(error) === 'ENOENT') fail('INTEGRITY');
    throw error;
  }
  regular(initial, expected?.identity);
  if (
    initial.size < 1n ||
    initial.size > BigInt(LIMIT) ||
    (expected && (initial.size !== expected.size || initial.mtimeNs !== expected.mtimeNs))
  )
    fail('INTEGRITY');
  const file = await open(location, READ_FLAGS);
  let result: ScannedFile;
  try {
    const before = await file.stat({ bigint: true });
    regular(before, identity(initial));
    if (before.size !== initial.size || before.mtimeNs !== initial.mtimeNs) fail('INTEGRITY');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    for (;;) {
      const read = await file.read(bytes, offset, bytes.length - offset, null);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
      if (offset > Number(before.size)) fail('INTEGRITY');
    }
    const after = await file.stat({ bigint: true });
    regular(after, identity(before));
    if (
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      offset !== Number(before.size)
    )
      fail('INTEGRITY');
    result = {
      bytes: Buffer.from(bytes.subarray(0, offset)),
      snapshot: { identity: identity(before), size: before.size, mtimeNs: before.mtimeNs },
    };
  } finally {
    await file.close();
  }
  await guardFile(location, result.snapshot);
  return result;
}
function encoded(value: unknown, code: SyntheticWorkerAdmissionErrorCode = 'INTEGRITY'): Buffer {
  const bytes = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  if (bytes.length > LIMIT) fail(code);
  return bytes;
}
function parsed(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('INTEGRITY');
  }
}
async function writeRecord(location: string, bytes: Buffer): Promise<FileSnapshot> {
  const file = await open(location, WRITE_FLAGS, 0o600);
  let written: FileSnapshot;
  try {
    const before = await file.stat({ bigint: true });
    regular(before);
    let offset = 0;
    while (offset < bytes.length) {
      const write = await file.write(bytes, offset, bytes.length - offset, null);
      if (write.bytesWritten < 1 || write.bytesWritten > bytes.length - offset)
        fail('PERSISTENCE_FAILED');
      offset += write.bytesWritten;
    }
    await file.sync();
    const after = await file.stat({ bigint: true });
    regular(after, identity(before));
    if (after.size !== BigInt(bytes.length)) fail('INTEGRITY');
    written = { identity: identity(after), size: after.size, mtimeNs: after.mtimeNs };
  } finally {
    await file.close();
  }
  const read = await scan(location, written);
  if (!read.bytes.equals(bytes)) fail('INTEGRITY');
  return read.snapshot;
}
async function commitCompletion(location: string, bytes: Buffer): Promise<void> {
  try {
    await writeRecord(location, bytes);
  } catch (error) {
    // A prior exact completion may have committed before its acknowledgement failed.
    // This read-only replay cannot repair a partial record or change its contents.
    if (nativeCode(error) !== 'EEXIST') throw error;
    const read = await scan(location);
    if (!read.bytes.equals(bytes)) fail('INTEGRITY');
  }
}
async function exclusiveDirectory(location: string): Promise<Directory> {
  try {
    await mkdir(location, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (nativeCode(error) === 'EEXIST') fail('BLOCKED');
    throw error;
  }
  return directory(location);
}
function owner(
  value: unknown,
  workerId: string,
  journalId: string,
  code: SyntheticWorkerAdmissionErrorCode,
): SyntheticWorkerOwner {
  const row = plain(value, OWNER_KEYS, code),
    result = Object.freeze({
      version: 1 as const,
      workerId: uuid(row.workerId, code),
      journalId: uuid(row.journalId, code),
      jobId: uuid(row.jobId, code),
      claimId: uuid(row.claimId, code),
      reservationId: uuid(row.reservationId, code),
    });
  if (row.version !== 1 || result.workerId !== workerId || result.journalId !== journalId)
    fail(code);
  return result;
}
function outcome(value: unknown, code: SyntheticWorkerAdmissionErrorCode): WindowsSyntheticOutcome {
  const descriptor =
    value && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'state')
      : undefined;
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(code);
  const unknown = descriptor.value === 'containment_unknown',
    row = plain(
      value,
      unknown
        ? ['state', 'termination', 'cleanupAllowed', 'safeCode']
        : ['state', 'termination', 'exitCode', 'activeProcesses', 'safeCode'],
      code,
    );
  if (typeof row.safeCode !== 'string' || !/^[A-Z_]{1,64}$/.test(row.safeCode)) fail(code);
  if (unknown) {
    if (row.termination !== 'unconfirmed' || row.cleanupAllowed !== false) fail(code);
    return Object.freeze({
      state: 'containment_unknown',
      termination: 'unconfirmed',
      cleanupAllowed: false,
      safeCode: row.safeCode,
    });
  }
  const exit =
    typeof row.exitCode === 'number' &&
    Number.isInteger(row.exitCode) &&
    row.exitCode >= 0 &&
    row.exitCode <= 0xffffffff;
  if (
    typeof row.state !== 'string' ||
    !['exited', 'failed', 'timed_out', 'cancelled'].includes(row.state) ||
    row.termination !== 'job_empty' ||
    row.activeProcesses !== 0 ||
    (row.exitCode !== null && !exit) ||
    (row.state === 'exited' && !exit)
  )
    fail(code);
  return Object.freeze({
    state: row.state as 'exited' | 'failed' | 'timed_out' | 'cancelled',
    termination: 'job_empty',
    exitCode: row.exitCode as number | null,
    activeProcesses: 0,
    safeCode: row.safeCode,
  });
}
function intent(
  value: unknown,
  expectedOwner: SyntheticWorkerOwner,
  configuration: JournalConfiguration,
  code: SyntheticWorkerAdmissionErrorCode,
): SyntheticAttemptIntent {
  const row = plain(value, INTENT_KEYS, code);
  if (
    row.version !== 1 ||
    typeof row.attempt !== 'number' ||
    !Number.isSafeInteger(row.attempt) ||
    row.attempt < 1 ||
    row.attempt > 3
  )
    fail(code);
  const result = Object.freeze({
    version: 1 as const,
    journalId: uuid(row.journalId, code),
    jobId: uuid(row.jobId, code),
    claimId: uuid(row.claimId, code),
    attempt: row.attempt,
    leaseNonce: uuid(row.leaseNonce, code),
    attemptDirectory: path.join(configuration.attemptParent, expectedOwner.jobId),
  });
  if (
    result.journalId !== configuration.journalId ||
    result.jobId !== expectedOwner.jobId ||
    result.claimId !== expectedOwner.claimId ||
    row.attemptDirectory !== result.attemptDirectory
  )
    fail(code);
  encoded(result, code);
  return result;
}
function terminal(
  value: unknown,
  expected: SyntheticAttemptIntent,
  configuration: JournalConfiguration,
  expectedOwner: SyntheticWorkerOwner,
): SyntheticAttemptTerminal {
  const row = plain(value, [...INTENT_KEYS, 'outcome'], 'INTEGRITY');
  const found = intent(
    {
      version: row.version,
      journalId: row.journalId,
      jobId: row.jobId,
      claimId: row.claimId,
      attempt: row.attempt,
      leaseNonce: row.leaseNonce,
      attemptDirectory: row.attemptDirectory,
    },
    expectedOwner,
    configuration,
    'INTEGRITY',
  );
  if (!encoded(found).equals(encoded(expected))) fail('INTEGRITY');
  return Object.freeze({ ...expected, outcome: outcome(row.outcome, 'INTEGRITY') });
}
function journalBinding(value: SyntheticAttemptIntent) {
  return Object.freeze({
    jobId: value.jobId,
    claimId: value.claimId,
    attempt: value.attempt,
    leaseNonce: value.leaseNonce,
  });
}
function journalConfiguration(value: unknown): JournalConfiguration {
  const row = plain(
    value,
    [
      'journalId',
      'rootDirectory',
      'attemptParent',
      'reserve',
      'consumeLaunchTicket',
      'recordTermination',
      'inspect',
      'close',
    ],
    'INVALID_CONFIGURATION',
  );
  for (const method of ['reserve', 'consumeLaunchTicket', 'recordTermination', 'inspect', 'close'])
    if (typeof row[method] !== 'function') fail('INVALID_CONFIGURATION');
  const source = value as SyntheticAttemptJournal,
    journalId = uuid(row.journalId, 'INVALID_CONFIGURATION'),
    rootDirectory = absolute(row.rootDirectory),
    attemptParent = absolute(row.attemptParent);
  // Snapshot the trusted capabilities as well as their metadata before factory I/O.
  const journal: SyntheticAttemptJournal = Object.freeze({
    journalId,
    rootDirectory,
    attemptParent,
    reserve: (row.reserve as SyntheticAttemptJournal['reserve']).bind(source),
    consumeLaunchTicket: (
      row.consumeLaunchTicket as SyntheticAttemptJournal['consumeLaunchTicket']
    ).bind(source),
    recordTermination: (row.recordTermination as SyntheticAttemptJournal['recordTermination']).bind(
      source,
    ),
    inspect: (row.inspect as SyntheticAttemptJournal['inspect']).bind(source),
    close: (row.close as SyntheticAttemptJournal['close']).bind(source),
  });
  return { journal, journalId, rootDirectory, attemptParent };
}
function separated(root: string, configuration: JournalConfiguration): void {
  for (const other of [configuration.rootDirectory, configuration.attemptParent])
    if (contained(root, other) || contained(other, root)) fail('INVALID_CONFIGURATION');
}

/**
 * Trusted stable local synthetic admission; terminal observations are not OS proof.
 * Retained history is never repaired/reclaimed or evaded by rotating configuration.
 * This module launches no process and supplies no same-job retry authority.
 */
function admission(
  rootDirectory: string,
  workerId: string,
  configuration: JournalConfiguration,
  directories: readonly Directory[],
  history: Directory,
  marker: FileSnapshot,
): SyntheticWorkerAdmission {
  const journalId = configuration.journalId,
    journal = configuration.journal,
    permits = new WeakMap<SyntheticWorkerPermit, LivePermit>();
  let busy = false,
    closing = false,
    tail: Promise<void> = Promise.resolve(),
    closed: Promise<void> | undefined;
  const markerBytes = encoded({ version: 1, workerId, journalId });
  async function guard(): Promise<void> {
    await guardDirectories([...directories, history]);
    await names(
      rootDirectory,
      ['worker.json', 'history', 'active'],
      ['worker.json', 'history'],
      ['history', 'active'],
    );
    const current = await scan(path.join(rootDirectory, 'worker.json'), marker);
    if (!current.bytes.equals(markerBytes)) fail('INTEGRITY');
  }
  function admitted<T>(operation: () => Promise<T>, prepare?: () => void): Promise<T> {
    if (closing) return Promise.reject(new SyntheticWorkerAdmissionError('CLOSED'));
    if (busy) return Promise.reject(new SyntheticWorkerAdmissionError('BUSY'));
    busy = true;
    try {
      prepare?.();
    } catch (error) {
      busy = false;
      return Promise.reject(mapped(error));
    }
    const work = (async () => {
      try {
        await guard();
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
  function live(permit: SyntheticWorkerPermit): LivePermit {
    const found = permit && typeof permit === 'object' ? permits.get(permit) : undefined;
    if (!found) fail('INVALID_PERMIT');
    return found;
  }
  async function readOwner(
    location: Directory,
    expected?: SyntheticWorkerOwner,
    expectedFile?: FileSnapshot,
  ): Promise<{ owner: SyntheticWorkerOwner; file: FileSnapshot }> {
    await guardDirectories([location]);
    const read = await scan(path.join(location.location, 'owner.json'), expectedFile),
      found = owner(parsed(read.bytes), workerId, journalId, 'INTEGRITY');
    if (!read.bytes.equals(encoded(found)) || (expected && !read.bytes.equals(encoded(expected))))
      fail('INTEGRITY');
    await guardDirectories([location]);
    return { owner: found, file: read.snapshot };
  }
  async function guardOwned(current: LivePermit, location = current.directory): Promise<void> {
    await guard();
    await guardDirectories([location]);
    await names(location.location, RECORDS, ['owner.json']);
    await readOwner(location, current.owner, current.ownerFile);
    await guardDirectories([location]);
  }
  async function archive(
    current: LivePermit,
    completion: SyntheticWorkerCompletion,
  ): Promise<void> {
    current.phase = 'releasing';
    await guardOwned(current);
    const envelope = await exclusiveDirectory(
      path.join(history.location, current.owner.reservationId),
    );
    await guardDirectories([...directories, history, envelope]);
    await names(envelope.location, []);
    const slot = path.join(envelope.location, 'slot');
    // The exclusive envelope owns this absent child; no existing history is replaced.
    await rename(current.directory.location, slot);
    current.phase = 'released';
    // A successor may now own root/active: never inspect that stale path again.
    const archived = await directory(slot, current.directory.identity);
    await guardOwned(current, archived);
    await names(envelope.location, ['slot'], ['slot'], ['slot']);
    const read = await scan(path.join(slot, 'completion.json'));
    if (!read.bytes.equals(encoded(completion))) fail('INTEGRITY');
    await guardDirectories([...directories, history, envelope, archived]);
  }
  function reserve(
    value: Readonly<{ jobId: string; claimId: string }>,
  ): Promise<SyntheticWorkerReservation> {
    let expected: SyntheticWorkerOwner, bytes: Buffer;
    try {
      const row = plain(value, ['jobId', 'claimId'], 'INVALID_INPUT');
      expected = Object.freeze({
        version: 1,
        workerId,
        journalId,
        jobId: uuid(row.jobId, 'INVALID_INPUT'),
        claimId: uuid(row.claimId, 'INVALID_INPUT'),
        reservationId: randomUUID(),
      });
      bytes = encoded(expected, 'INVALID_INPUT');
    } catch (error) {
      return Promise.reject(
        error instanceof SyntheticWorkerAdmissionError
          ? error
          : new SyntheticWorkerAdmissionError('INVALID_INPUT'),
      );
    }
    return admitted(async () => {
      const active = await exclusiveDirectory(path.join(rootDirectory, 'active'));
      await guardDirectories([...directories, history, active]);
      await names(active.location, []);
      const file = await writeRecord(path.join(active.location, 'owner.json'), bytes),
        committed = await readOwner(active, expected, file);
      await guard();
      await guardDirectories([active]);
      const permit = Object.freeze({ kind: 'synthetic_worker' }) as SyntheticWorkerPermit;
      permits.set(permit, {
        owner: committed.owner,
        directory: active,
        ownerFile: committed.file,
        phase: 'unarmed',
        ready: false,
      });
      return Object.freeze({ permit, owner: committed.owner });
    });
  }
  function arm(permit: SyntheticWorkerPermit, value: SyntheticAttemptReservation): Promise<void> {
    let current: LivePermit,
      expected: SyntheticAttemptIntent,
      ticket: SyntheticAttemptTicket,
      launchBytes: Buffer;
    try {
      current = live(permit);
      if (current.phase !== 'unarmed') fail('INVALID_STATE');
      const row = plain(value, ['ticket', 'intent'], 'INVALID_INPUT');
      const token = plain(row.ticket, ['kind'], 'INVALID_INPUT');
      if (token.kind !== 'synthetic_attempt' || !Object.isFrozen(row.ticket)) fail('INVALID_INPUT');
      ticket = row.ticket as SyntheticAttemptTicket;
      expected = intent(row.intent, current.owner, configuration, 'INVALID_INPUT');
      launchBytes = encoded({ owner: current.owner, intent: expected }, 'INVALID_INPUT');
      encoded(
        {
          owner: current.owner,
          state: 'job_empty',
          terminal: {
            ...expected,
            outcome: {
              state: 'timed_out',
              termination: 'job_empty',
              exitCode: 0xffffffff,
              activeProcesses: 0,
              safeCode: 'X'.repeat(64),
            },
          },
        },
        'INVALID_INPUT',
      );
    } catch (error) {
      return Promise.reject(
        error instanceof SyntheticWorkerAdmissionError
          ? error
          : new SyntheticWorkerAdmissionError('INVALID_INPUT'),
      );
    }
    return admitted(
      async () => {
        await guardOwned(current);
        const inspection = plain(
          await journal.inspect(journalBinding(expected)),
          ['state', 'reason', 'intent', 'terminal'],
          'INTEGRITY',
        );
        if (
          inspection.state !== 'blocked' ||
          inspection.reason !== 'UNCONFIRMED' ||
          inspection.terminal !== null ||
          !inspection.intent ||
          !encoded(intent(inspection.intent, current.owner, configuration, 'INTEGRITY')).equals(
            encoded(expected),
          )
        )
          fail('INVALID_STATE');
        await guardOwned(current);
        await writeRecord(path.join(current.directory.location, 'launch.json'), launchBytes);
        await guardOwned(current);
        current.ready = true;
      },
      () => {
        current.phase = 'armed';
        current.intent = expected;
        current.ticket = ticket;
        const consumed = intent(
          journal.consumeLaunchTicket(ticket),
          current.owner,
          configuration,
          'INVALID_STATE',
        );
        if (!encoded(consumed).equals(encoded(expected))) fail('INVALID_STATE');
      },
    );
  }
  function releaseBeforeLaunch(
    permit: SyntheticWorkerPermit,
  ): Promise<Extract<SyntheticWorkerCompletion, { state: 'not_launched' }>> {
    let current: LivePermit,
      completion: Extract<SyntheticWorkerCompletion, { state: 'not_launched' }>,
      bytes: Buffer;
    try {
      current = live(permit);
      if (current.phase !== 'unarmed') fail('INVALID_STATE');
      completion = Object.freeze({ owner: current.owner, state: 'not_launched' });
      bytes = encoded(completion, 'INVALID_INPUT');
    } catch (error) {
      return Promise.reject(mapped(error));
    }
    return admitted(
      async () => {
        await guardOwned(current);
        await writeRecord(path.join(current.directory.location, 'completion.json'), bytes);
        await guardOwned(current);
        await archive(current, completion);
        return completion;
      },
      () => {
        current.phase = 'releasing';
      },
    );
  }
  function confirmTermination(
    permit: SyntheticWorkerPermit,
    value: WindowsSyntheticOutcome,
  ): Promise<SyntheticWorkerCompletion | SyntheticWorkerRetained> {
    let current: LivePermit, snapshot: WindowsSyntheticOutcome;
    try {
      current = live(permit);
      if (current.phase !== 'armed' || !current.ready || !current.intent || !current.ticket)
        fail('INVALID_STATE');
      snapshot = outcome(value, 'INVALID_INPUT');
      if (current.outcome && !encoded(current.outcome).equals(encoded(snapshot))) fail('BLOCKED');
    } catch (error) {
      return Promise.reject(
        error instanceof SyntheticWorkerAdmissionError
          ? error
          : new SyntheticWorkerAdmissionError('INVALID_INPUT'),
      );
    }
    return admitted(
      async () => {
        await guardOwned(current);
        const expected = current.intent!,
          ticket = current.ticket!;
        const recorded = terminal(
          await journal.recordTermination(ticket, snapshot),
          expected,
          configuration,
          current.owner,
        );
        if (!encoded(recorded.outcome).equals(encoded(snapshot))) fail('INTEGRITY');
        const inspection = plain(
          await journal.inspect(journalBinding(expected)),
          ['state', 'reason', 'intent', 'terminal'],
          'INTEGRITY',
        );
        if (
          !inspection.intent ||
          !encoded(intent(inspection.intent, current.owner, configuration, 'INTEGRITY')).equals(
            encoded(expected),
          ) ||
          !inspection.terminal
        )
          fail('INTEGRITY');
        const readback = terminal(inspection.terminal, expected, configuration, current.owner);
        if (!encoded(recorded).equals(encoded(readback))) fail('INTEGRITY');
        await guardOwned(current);
        if (snapshot.state === 'containment_unknown') {
          if (inspection.state !== 'blocked' || inspection.reason !== 'CONTAINMENT_UNKNOWN')
            fail('INTEGRITY');
          current.phase = 'retained';
          return Object.freeze({ state: 'blocked', reason: 'CONTAINMENT_UNKNOWN' });
        }
        if (inspection.state !== 'termination_recorded' || inspection.reason !== null)
          fail('INTEGRITY');
        const completion = Object.freeze({
          owner: current.owner,
          state: 'job_empty' as const,
          terminal: readback,
        });
        await commitCompletion(
          path.join(current.directory.location, 'completion.json'),
          encoded(completion),
        );
        await guardOwned(current);
        await archive(current, completion);
        return completion;
      },
      () => {
        current.outcome ??= snapshot;
      },
    );
  }
  function inspect(): Promise<SyntheticWorkerInspection> {
    return admitted(async () => {
      let active: Directory;
      try {
        active = await directory(path.join(rootDirectory, 'active'));
      } catch (error) {
        if (error instanceof SyntheticWorkerAdmissionError && error.code === 'INTEGRITY') {
          try {
            await lstat(path.join(rootDirectory, 'active'));
          } catch (missing) {
            if (nativeCode(missing) === 'ENOENT') {
              await guard();
              return Object.freeze({ state: 'idle', owner: null });
            }
            throw missing;
          }
        }
        throw error;
      }
      const present = await names(active.location, RECORDS);
      if (!present.includes('owner.json')) {
        if (present.length) fail('INTEGRITY');
        await guard();
        await guardDirectories([active]);
        return Object.freeze({ state: 'blocked', owner: null });
      }
      const found = await readOwner(active);
      let foundIntent: SyntheticAttemptIntent | undefined;
      if (present.includes('launch.json')) {
        const read = await scan(path.join(active.location, 'launch.json')),
          row = plain(parsed(read.bytes), ['owner', 'intent'], 'INTEGRITY'),
          bound = owner(row.owner, workerId, journalId, 'INTEGRITY');
        if (!encoded(bound).equals(encoded(found.owner))) fail('INTEGRITY');
        foundIntent = intent(row.intent, found.owner, configuration, 'INTEGRITY');
        if (!read.bytes.equals(encoded({ owner: found.owner, intent: foundIntent })))
          fail('INTEGRITY');
      }
      if (present.includes('completion.json')) {
        const read = await scan(path.join(active.location, 'completion.json')),
          raw = parsed(read.bytes),
          descriptor =
            raw && typeof raw === 'object'
              ? Object.getOwnPropertyDescriptor(raw, 'state')
              : undefined;
        const row = plain(
            raw,
            descriptor?.value === 'not_launched'
              ? ['owner', 'state']
              : ['owner', 'state', 'terminal'],
            'INTEGRITY',
          ),
          bound = owner(row.owner, workerId, journalId, 'INTEGRITY');
        if (!encoded(bound).equals(encoded(found.owner))) fail('INTEGRITY');
        if (row.state === 'not_launched') {
          if (
            foundIntent ||
            !read.bytes.equals(encoded({ owner: found.owner, state: 'not_launched' }))
          )
            fail('INTEGRITY');
        } else {
          if (row.state !== 'job_empty' || !foundIntent) fail('INTEGRITY');
          const ended = terminal(row.terminal, foundIntent, configuration, found.owner);
          if (
            ended.outcome.termination !== 'job_empty' ||
            !read.bytes.equals(encoded({ owner: found.owner, state: 'job_empty', terminal: ended }))
          )
            fail('INTEGRITY');
        }
      }
      await guard();
      await guardDirectories([active]);
      await readOwner(active, found.owner, found.file);
      return Object.freeze({ state: 'blocked', owner: found.owner });
    });
  }
  function close(): Promise<void> {
    closing = true;
    closed ??= tail;
    return closed;
  }
  return Object.freeze({
    rootDirectory,
    workerId,
    journalId,
    reserve,
    arm,
    releaseBeforeLaunch,
    confirmTermination,
    inspect,
    close,
  });
}

export async function createSyntheticWorkerAdmission(
  value: SyntheticWorkerAdmissionConfiguration,
): Promise<SyntheticWorkerAdmission> {
  let parent: string,
    configuration: JournalConfiguration,
    parents: Directory[],
    workerId: string,
    root: string;
  try {
    const row = plain(value, ['parentDirectory', 'journal'], 'INVALID_CONFIGURATION');
    parent = absolute(row.parentDirectory);
    configuration = journalConfiguration(row.journal);
    parents = await ancestors(parent);
    workerId = randomUUID();
    root = path.join(parent, 'worker-' + workerId);
    separated(root, configuration);
  } catch {
    return fail('INVALID_CONFIGURATION');
  }
  try {
    const created = await exclusiveDirectory(root),
      history = await exclusiveDirectory(path.join(root, 'history'));
    await guardDirectories([...parents, created, history]);
    const marker = await writeRecord(
      path.join(root, 'worker.json'),
      encoded({ version: 1, workerId, journalId: configuration.journalId }),
    );
    await names(root, ['worker.json', 'history'], ['worker.json', 'history'], ['history']);
    await guardDirectories([...parents, created, history]);
    return admission(root, workerId, configuration, [created, ...parents], history, marker);
  } catch (error) {
    throw mapped(error);
  }
}
export async function reopenSyntheticWorkerAdmission(
  value: SyntheticWorkerAdmissionReopenConfiguration,
): Promise<SyntheticWorkerAdmission> {
  let root: string, workerId: string, configuration: JournalConfiguration, parents: Directory[];
  try {
    const row = plain(value, ['rootDirectory', 'workerId', 'journal'], 'INVALID_CONFIGURATION');
    root = absolute(row.rootDirectory);
    workerId = uuid(row.workerId, 'INVALID_CONFIGURATION');
    configuration = journalConfiguration(row.journal);
    separated(root, configuration);
    parents = await ancestors(root);
  } catch {
    return fail('INVALID_CONFIGURATION');
  }
  try {
    if (path.basename(root).toLowerCase() !== 'worker-' + workerId) fail('INTEGRITY');
    const history = await directory(path.join(root, 'history'));
    await names(
      root,
      ['worker.json', 'history', 'active'],
      ['worker.json', 'history'],
      ['history', 'active'],
    );
    const marker = await scan(path.join(root, 'worker.json'));
    if (!marker.bytes.equals(encoded({ version: 1, workerId, journalId: configuration.journalId })))
      fail('INTEGRITY');
    await guardDirectories([...parents, history]);
    return admission(root, workerId, configuration, parents, history, marker.snapshot);
  } catch (error) {
    throw mapped(error);
  }
}
