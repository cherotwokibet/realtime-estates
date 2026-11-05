import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyntheticAttemptFiles } from './attempt-files.js';
import {
  createFloorPlanWorkerAdmission,
  snapshotFloorPlanWorkerTarget,
  validateFloorPlanWorkerLease,
  type FloorPlanWorkerTarget,
  type PreparedFloorPlanWorker,
} from './floor-plan-admission.js';
import { verifySyntheticFloorPlanReadback } from './process-readback.js';
import type { WindowsSyntheticSupervisor, WindowsSyntheticOutcome } from './windows-supervisor.js';
export class FloorPlanProcessingError extends Error {
  override readonly name = 'FloorPlanProcessingError';
  constructor(
    readonly code:
      'INVALID_CONFIGURATION' | 'INTEGRITY' | 'PERSISTENCE_FAILED' | 'BUSY' | 'CLOSED' | 'BLOCKED',
  ) {
    super(`Floor-plan processing: ${code}.`);
  }
}
function fail(code: FloorPlanProcessingError['code']): never {
  throw new FloorPlanProcessingError(code);
}
const files = createSyntheticAttemptFiles(fail);
/** Fixed local decoder composition. Readback is not a SQL output seal or attachment receipt. */
export async function createFloorPlanProcessor(
  config: Parameters<typeof createFloorPlanWorkerAdmission>[0] & {
    readonly supervisor: WindowsSyntheticSupervisor;
  },
) {
  const admission = createFloorPlanWorkerAdmission(config),
    worker = config.worker,
    preflight = config.preflight;
  if (typeof config.supervisor?.run !== 'function') fail('INVALID_CONFIGURATION');
  const supervise = config.supervisor.run.bind(config.supervisor);
  const node = files.absolute(process.execPath),
    codec = files.absolute(fileURLToPath(new URL('./floor-plan-worker.js', import.meta.url)));
  const parent = files.absolute(config.journal.attemptParent);
  const paths = [
    ...(await files.ancestry(parent)),
    ...(await files.ancestry(path.dirname(node))),
    await files.checked(node, false),
    ...(await files.ancestry(path.dirname(codec))),
    await files.checked(codec, false),
  ];
  let busy = false,
    closed = false,
    tail: Promise<unknown> = Promise.resolve();
  async function execute(target: FloorPlanWorkerTarget) {
    let p: PreparedFloorPlanWorker | undefined,
      armed = false;
    try {
      await files.guards(paths);
      p = await admission.prepare(target);
      if (p.attempt.intent.attemptDirectory !== path.join(parent, p.lease.target.jobId))
        fail('INTEGRITY');
      const dir = await files.checked(p.attempt.intent.attemptDirectory, true);
      await files.writeSource(dir, p.source);
      await files.guards(paths);
      // arm consumes the live journal ticket. Every failure after this point retains uncertainty.
      armed = true;
      await admission.arm(p);
      await files.guards(paths);
      await files.checked(dir.location, true, dir);
      if (!(await files.boundedFile(dir, 'source.input', 10485760)).equals(p.source))
        fail('INTEGRITY');
      if (Date.parse(p.lease.expiresAt) <= Date.now()) fail('BLOCKED');
      let observed: WindowsSyntheticOutcome;
      try {
        observed = await supervise({
          executablePath: node,
          arguments: [codec],
          workingDirectory: dir.location,
          timeoutMs: 10000,
          maxProcesses: 1,
        });
      } catch {
        observed = Object.freeze({
          state: 'containment_unknown',
          termination: 'unconfirmed',
          cleanupAllowed: false,
          safeCode: 'UNCONFIRMED_NATIVE_OUTCOME',
        });
      }
      const completion = await worker.confirmTermination(p.permit, observed);
      if (
        completion.state !== 'job_empty' ||
        observed.termination !== 'job_empty' ||
        observed.state !== 'exited' ||
        observed.exitCode !== 0
      )
        return Object.freeze({ state: 'native_failed' as const, outcome: observed });
      await files.guards(paths);
      await files.expectedFiles(dir);
      const source = await files.boundedFile(dir, 'source.input', 10485760);
      if (!source.equals(p.source)) fail('INTEGRITY');
      const converted = await files.boundedFile(dir, 'converted.webp', 10485760),
        sidecar = await files.boundedFile(dir, 'manifest.json', 4096);
      const result = verifySyntheticFloorPlanReadback(source, converted, sidecar);
      const fresh = validateFloorPlanWorkerLease(
        await preflight(p.lease.target),
        p.lease.target,
        source,
      );
      if (JSON.stringify(fresh) !== JSON.stringify(p.lease)) fail('INTEGRITY');
      await files.guards(paths);
      await files.expectedFiles(dir);
      return Object.freeze({
        state: 'readback_verified' as const,
        lease: p.lease,
        result,
        outcome: observed,
      });
    } catch (error) {
      if (p && !armed) {
        try {
          await admission.cancel(p);
        } catch {
          /* Preserve uncertain original state. */
        }
      }
      throw error;
    }
  }
  return Object.freeze({
    run(target: FloorPlanWorkerTarget) {
      if (closed) return Promise.reject(new FloorPlanProcessingError('CLOSED'));
      if (busy) return Promise.reject(new FloorPlanProcessingError('BUSY'));
      const selected = snapshotFloorPlanWorkerTarget(target);
      busy = true;
      const work = execute(selected).finally(() => {
        busy = false;
      });
      tail = work.then(
        () => {},
        () => {},
      );
      return work;
    },
    close() {
      closed = true;
      return tail.then(() => admission.close());
    },
  });
}
