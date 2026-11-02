import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const exited = (child) => child.exitCode !== null || child.signalCode !== null;

/** Retire only this owned child, and observe its exit before a replacement can start. */
export async function retireOwnedStaffChild(
  child,
  { platform = process.platform, executeFile = execute, timeoutMs = 5000 } = {},
) {
  if (!child || exited(child) || !Number.isSafeInteger(child.pid) || child.pid <= 0) return;
  let timer,
    observed = false,
    onExit;
  const exitResult = new Promise((resolve) => {
    onExit = () => {
      observed = true;
      resolve(true);
    };
    child.once('exit', onExit);
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    if (platform === 'win32') {
      try {
        await executeFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: timeoutMs,
        });
      } catch {
        // An exit between the initial check and taskkill is safe only after confirmation.
        if ((await exitResult) || observed || exited(child)) return;
        throw Error('Owned staff child retirement could not be confirmed.');
      }
    } else {
      child.kill('SIGTERM');
    }
    if (!(await exitResult) && !observed && !exited(child))
      throw Error('Owned staff child exit could not be confirmed.');
  } finally {
    clearTimeout(timer);
    child.removeListener('exit', onExit);
  }
}

/** One shared shutdown promise; fixture closure is attempted even when child cleanup fails. */
export function createStaffPreviewShutdown({ closeInput, takeChild, retireChild, closeApi }) {
  let stopping;
  return Object.freeze({
    isStopping: () => stopping !== undefined,
    stop() {
      if (stopping) return stopping;
      stopping = Promise.resolve().then(async () => {
        const errors = [];
        try {
          closeInput();
        } catch (error) {
          errors.push(error);
        }
        try {
          await retireChild(takeChild());
        } catch (error) {
          errors.push(error);
        }
        try {
          await closeApi();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, 'Owned staff preview cleanup failed.');
      });
      return stopping;
    },
  });
}
