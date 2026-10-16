import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WindowsSyntheticSupervisorOptions {
  readonly powerShellPath: string;
  readonly attemptParent: string;
}
export interface WindowsSyntheticProcessRequest {
  /** Trusted fixed Node binary, never a browser-selected executable. */
  readonly executablePath: string;
  /** First item is an absolute trusted .js/.mjs entry point; later items are data. */
  readonly arguments: readonly string[];
  /** Fresh existing direct child of attemptParent, owned by the coordinator. */
  readonly workingDirectory: string;
  /** Native child deadline; compilation also has a separate overall watchdog. */
  readonly timeoutMs: number;
  /** Four is reserved for the explicitly trusted descendant fixture. */
  readonly maxProcesses?: 1 | 4;
}
export type WindowsSyntheticOutcome =
  | Readonly<{
      state: 'exited' | 'failed' | 'timed_out' | 'cancelled';
      termination: 'job_empty';
      exitCode: number | null;
      activeProcesses: 0;
      safeCode: string;
    }>
  | Readonly<{
      state: 'containment_unknown';
      termination: 'unconfirmed';
      cleanupAllowed: false;
      safeCode: string;
    }>;
export interface WindowsSyntheticSupervisor {
  run(
    request: WindowsSyntheticProcessRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<WindowsSyntheticOutcome>;
}
export type WindowsSupervisorErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'INVALID_CONFIGURATION'
  | 'BUSY'
  | 'REUSED_ATTEMPT'
  | 'CONTAINMENT_BLOCKED';
export class WindowsSupervisorError extends Error {
  override readonly name = 'WindowsSupervisorError';
  constructor(
    readonly code: WindowsSupervisorErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_PIPE_BYTES = 8 * 1024;
const STARTUP_BUDGET_MS = 30_000;
const TERMINATION_BUDGET_MS = 8_000; // Native owned-job accounting barrier is5s.
const SCRIPT_PATH = fileURLToPath(new URL('../runtime/windows-supervisor.ps1', import.meta.url));
const TERMINAL_KEYS = ['state', 'termination', 'exitCode', 'activeProcesses', 'safeCode'] as const;
const STATES = new Set(['exited', 'failed', 'timed_out', 'cancelled', 'containment_unknown']);
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeRemoveListener = EventTarget.prototype.removeEventListener;

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
}
interface CheckedPath {
  readonly location: string;
  readonly identity: FileIdentity;
}
const canonical = (value: string): string => path.resolve(value).toLowerCase();
const unknown = (safeCode: string): WindowsSyntheticOutcome =>
  Object.freeze({
    state: 'containment_unknown',
    termination: 'unconfirmed',
    cleanupAllowed: false,
    safeCode,
  });
function invalid(): never {
  throw new WindowsSupervisorError(
    'INVALID_CONFIGURATION',
    'Trusted Windows supervisor configuration is invalid or changed.',
  );
}
const isUint32 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** Strict native-protocol decoder, exported to test malformed input without launching a process. */
export function parseWindowsSyntheticTerminal(protocol: string): WindowsSyntheticOutcome {
  try {
    if (
      typeof protocol !== 'string' ||
      Buffer.byteLength(protocol, 'utf8') > MAX_PIPE_BYTES ||
      !/^\{[^\r\n]*\}\r?\n?$/.test(protocol)
    )
      return unknown('PROTOCOL_INVALID');
    const raw = protocol.trimEnd();
    const result: unknown = JSON.parse(raw);
    if (typeof result !== 'object' || result === null || Array.isArray(result))
      return unknown('PROTOCOL_INVALID');
    const object = result as Record<string, unknown>;
    const keys = Object.keys(object);
    if (
      keys.length !== TERMINAL_KEYS.length ||
      keys.some((key) => !(TERMINAL_KEYS as readonly string[]).includes(key))
    )
      return unknown('PROTOCOL_INVALID');
    const rawKeys = [...raw.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(
      (match) => JSON.parse(match[1]!) as unknown,
    );
    if (rawKeys.length !== TERMINAL_KEYS.length || new Set(rawKeys).size !== TERMINAL_KEYS.length)
      return unknown('PROTOCOL_INVALID');
    if (
      typeof object.state !== 'string' ||
      !STATES.has(object.state) ||
      typeof object.safeCode !== 'string' ||
      !/^[A-Z_]{1,64}$/.test(object.safeCode) ||
      (object.exitCode !== null && !isUint32(object.exitCode)) ||
      (object.activeProcesses !== null &&
        (!Number.isInteger(object.activeProcesses) ||
          (object.activeProcesses as number) < 0 ||
          (object.activeProcesses as number) > 4))
    ) {
      return unknown('PROTOCOL_INVALID');
    }
    // Native integer fields must be original integer literals, never fractions/exponents
    // rounded by JSON.parse. Decoded escaped/duplicate field names are included above.
    for (const match of raw.matchAll(/("(?:[^"\\]|\\.)*")\s*:\s*([^,}]+)/g)) {
      const key = JSON.parse(match[1]!) as unknown;
      if (
        (key === 'exitCode' || key === 'activeProcesses') &&
        !/^(?:null|0|[1-9][0-9]*)\s*$/.test(match[2]!)
      )
        return unknown('PROTOCOL_INVALID');
    }
    if (object.state === 'containment_unknown') {
      return object.termination === 'unconfirmed'
        ? unknown(object.safeCode)
        : unknown('PROTOCOL_INVALID');
    }
    if (
      object.termination !== 'job_empty' ||
      object.activeProcesses !== 0 ||
      (object.state === 'exited' && !isUint32(object.exitCode))
    )
      return unknown('PROTOCOL_INVALID');
    return Object.freeze({
      state: object.state as 'exited' | 'failed' | 'timed_out' | 'cancelled',
      termination: 'job_empty',
      exitCode: object.exitCode as number | null,
      activeProcesses: 0,
      safeCode: object.safeCode,
    });
  } catch {
    return unknown('PROTOCOL_INVALID');
  }
}

async function checkPath(
  location: string,
  directory: boolean,
  previous?: FileIdentity,
): Promise<CheckedPath> {
  if (
    typeof location !== 'string' ||
    !path.isAbsolute(location) ||
    location.includes('\0') ||
    path.parse(location).root.startsWith('\\\\')
  )
    invalid();
  const resolved = path.resolve(location);
  const stat = await lstat(resolved, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    canonical(await realpath(resolved)) !== canonical(resolved)
  )
    invalid();
  const identity = { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
  if (
    previous &&
    (identity.dev !== previous.dev ||
      identity.ino !== previous.ino ||
      identity.birthtimeNs !== previous.birthtimeNs)
  )
    invalid();
  return { location: resolved, identity };
}

/**
 * Windows-only local synthetic supervisor. Native Job Objects establish owned lifetime
 * accounting, not filesystem/network isolation, restricted tokens or native-memory caps.
 * All configuration and scripts are trusted. Stable path checks cannot defeat hostile
 * same-user reparse races. This adapter creates/deletes NO attempt directories/files.
 */
export async function createWindowsSyntheticSupervisor(
  options: WindowsSyntheticSupervisorOptions,
): Promise<WindowsSyntheticSupervisor> {
  if (process.platform !== 'win32')
    throw new WindowsSupervisorError(
      'UNSUPPORTED_PLATFORM',
      'This synthetic supervisor requires Windows.',
    );
  let powerShell: CheckedPath, parent: CheckedPath, script: CheckedPath, systemRoot: CheckedPath;
  try {
    powerShell = await checkPath(options.powerShellPath, false);
    if (!/^(?:pwsh|powershell)\.exe$/i.test(path.basename(powerShell.location))) invalid();
    parent = await checkPath(options.attemptParent, true);
    script = await checkPath(SCRIPT_PATH, false);
    systemRoot = await checkPath(process.env.SystemRoot ?? process.env.WINDIR ?? '', true);
  } catch {
    invalid();
  }
  let active = false;
  let blocked = false;
  const usedAttempts = new Set<string>();

  async function run(
    request: WindowsSyntheticProcessRequest,
    runOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<WindowsSyntheticOutcome> {
    if (blocked)
      throw new WindowsSupervisorError(
        'CONTAINMENT_BLOCKED',
        'An unknown containment outcome blocks this supervisor instance.',
      );
    if (active)
      throw new WindowsSupervisorError(
        'BUSY',
        'Only one local synthetic process job may run at a time.',
      );
    active = true;
    try {
      let signal: AbortSignal | undefined;
      try {
        const value: unknown = runOptions.signal;
        if (value !== undefined) {
          // Calling the native getter proves internal AbortSignal slots rather than
          // accepting a forged prototype or mutable addEventListener implementation.
          if (typeof nativeAborted.call(value) !== 'boolean') invalid();
          signal = value as AbortSignal;
        }
      } catch {
        invalid();
      }
      // Snapshot trusted argument data before the first await.
      if (
        !request ||
        !Array.isArray(request.arguments) ||
        request.arguments.length < 1 ||
        request.arguments.length > 64 ||
        request.arguments.some(
          (argument) =>
            typeof argument !== 'string' || argument.length > 4096 || argument.includes('\0'),
        ) ||
        !Number.isSafeInteger(request.timeoutMs) ||
        request.timeoutMs < 1 ||
        request.timeoutMs > 120_000 ||
        (request.maxProcesses !== undefined &&
          request.maxProcesses !== 1 &&
          request.maxProcesses !== 4)
      )
        invalid();
      const config = {
        executablePath: request.executablePath,
        arguments: [...request.arguments],
        workingDirectory: request.workingDirectory,
        timeoutMs: request.timeoutMs,
        maxProcesses: request.maxProcesses ?? 1,
      };
      let node: CheckedPath, attempt: CheckedPath;
      try {
        await checkPath(powerShell.location, false, powerShell.identity);
        await checkPath(script.location, false, script.identity);
        await checkPath(parent.location, true, parent.identity);
        await checkPath(systemRoot.location, true, systemRoot.identity);
        node = await checkPath(config.executablePath, false);
        if (path.basename(node.location).toLowerCase() !== 'node.exe') invalid();
        attempt = await checkPath(config.workingDirectory, true);
        if (canonical(path.dirname(attempt.location)) !== canonical(parent.location)) invalid();
        const entry = await checkPath(config.arguments[0]!, false);
        if (!/\.(?:mjs|js)$/i.test(entry.location)) invalid();
      } catch {
        invalid();
      }
      const attemptKey = canonical(attempt.location);
      if (usedAttempts.has(attemptKey))
        throw new WindowsSupervisorError(
          'REUSED_ATTEMPT',
          'Each synthetic process run requires a fresh owned attempt directory.',
        );
      const line = JSON.stringify(config) + '\n';
      if (Buffer.byteLength(line, 'utf8') > MAX_CONFIG_BYTES) invalid();
      usedAttempts.add(attemptKey);
      const env: NodeJS.ProcessEnv = {
        SystemRoot: systemRoot.location,
        WINDIR: systemRoot.location,
        // Windows libuv fills certain omitted "required_vars" from the coordinator
        // environment even with an explicit env object. Presence with an empty value
        // prevents forwarding profile/account settings; OS drive comes from SystemRoot.
        SYSTEMDRIVE: path.parse(systemRoot.location).root.replace(/[\\/]$/, ''),
        USERPROFILE: '',
        HOMEDRIVE: '',
        HOMEPATH: '',
        LOGONSERVER: '',
        USERDOMAIN: '',
        USERNAME: '',
        PATH: [path.dirname(node.location), path.join(systemRoot.location, 'System32')].join(
          path.delimiter,
        ),
        TEMP: attempt.location,
        TMP: attempt.location,
      };
      const result = await new Promise<WindowsSyntheticOutcome>((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(
            powerShell.location,
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script.location],
            {
              cwd: attempt.location,
              env,
              shell: false,
              windowsHide: true,
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
        } catch {
          blocked = true;
          resolve(unknown('SUPERVISOR_START_FAILURE'));
          return;
        }
        let settled = false;
        let stdoutBytes = 0,
          stderrBytes = 0;
        const stdout: Buffer[] = [];
        let cancellationRequested = false;
        let cancellationWatchdog: ReturnType<typeof setTimeout> | undefined;
        const overallWatchdog = setTimeout(
          () => uncertain('SUPERVISOR_WATCHDOG'),
          STARTUP_BUDGET_MS + config.timeoutMs + TERMINATION_BUDGET_MS,
        );

        function settle(outcome: WindowsSyntheticOutcome): void {
          if (settled) return;
          settled = true;
          clearTimeout(overallWatchdog);
          if (cancellationWatchdog) clearTimeout(cancellationWatchdog);
          if (signal) nativeRemoveListener.call(signal, 'abort', cancel);
          if (outcome.termination === 'unconfirmed') blocked = true;
          resolve(outcome);
        }
        function uncertain(code: string): void {
          if (settled) return;
          settle(unknown(code)); // Latch before kill(): a synchronous error cannot reenter.
          // Only the owned ChildProcess handle is signalled; no taskkill/PID/tree guess.
          // Signal delivery and subsequent close never establish a native empty barrier.
          try {
            child.kill();
          } catch {
            /* termination remains unconfirmed */
          }
        }
        function cancel(): void {
          if (settled || cancellationRequested) return;
          cancellationRequested = true;
          cancellationWatchdog = setTimeout(
            () => uncertain('CANCELLATION_UNCONFIRMED'),
            TERMINATION_BUDGET_MS,
          );
          try {
            child.stdin?.write('cancel\n', (error) => {
              if (error && !settled) uncertain('SUPERVISOR_INPUT_FAILURE');
            });
          } catch {
            uncertain('SUPERVISOR_INPUT_FAILURE');
          }
        }
        // Install the ChildProcess error listener before touching pipes. Failed spawn
        // paths may have null pipes and must still latch unknown rather than throw.
        child.on('error', () => {
          if (!settled) uncertain('SUPERVISOR_START_FAILURE');
        });
        child.on('close', (code) => {
          if (settled) return;
          if (code !== 0) {
            settle(unknown('SUPERVISOR_EXIT_UNCONFIRMED'));
            return;
          }
          let protocol: string;
          try {
            protocol = new TextDecoder('utf-8', { fatal: true }).decode(
              Buffer.concat(stdout, stdoutBytes),
            );
          } catch {
            settle(unknown('PROTOCOL_INVALID'));
            return;
          }
          settle(parseWindowsSyntheticTerminal(protocol));
        });
        if (!child.stdin || !child.stdout || !child.stderr) {
          uncertain('SUPERVISOR_STREAMS_UNAVAILABLE');
          return;
        }
        try {
          child.stdout.on('data', (chunk: Buffer) => {
            if (settled) return; // Continue draining, never accumulate late bytes.
            stdoutBytes += chunk.length;
            if (stdoutBytes > MAX_PIPE_BYTES) uncertain('SUPERVISOR_OUTPUT_LIMIT');
            else stdout.push(Buffer.from(chunk));
          });
          child.stderr.on('data', (chunk: Buffer) => {
            if (settled) return;
            stderrBytes += chunk.length;
            if (stderrBytes > MAX_PIPE_BYTES) uncertain('SUPERVISOR_OUTPUT_LIMIT');
          });
          child.stdin.on('error', () => {
            if (!settled) uncertain('SUPERVISOR_INPUT_FAILURE');
          });
          child.stdout.on('error', () => {
            if (!settled) uncertain('SUPERVISOR_OUTPUT_FAILURE');
          });
          child.stderr.on('error', () => {
            if (!settled) uncertain('SUPERVISOR_OUTPUT_FAILURE');
          });
          child.stdin.write(line, (error) => {
            if (error && !settled) uncertain('SUPERVISOR_INPUT_FAILURE');
          });
          if (signal) {
            nativeAddListener.call(signal, 'abort', cancel, { once: true });
            if (nativeAborted.call(signal)) cancel();
          }
        } catch {
          uncertain('SUPERVISOR_PROTOCOL_FAILURE');
        }
      });
      return result;
    } finally {
      active = false;
    }
  }

  return Object.freeze({ run });
}
