import { authChangeEffect } from '@realtor/browser-auth/events';

/** A local invalidation barrier, never a substitute for server authorization. */
export class PrivateWorkspaceCleared extends Error {
  constructor() {
    super('Private workspace access has been cleared.');
    this.name = 'PrivateWorkspaceCleared';
  }
}

export function createPrivateWorkspaceGuard(onClear: () => void) {
  let closed = false;
  const flights = new Set<AbortController>();
  function close(notify: boolean) {
    if (closed) return;
    closed = true;
    for (const controller of flights) controller.abort();
    flights.clear();
    if (notify) onClear();
  }
  return {
    get cleared() {
      return closed;
    },
    invalidate() {
      close(true);
    },
    dispose() {
      close(false);
    },
    observe(event: unknown) {
      if (authChangeEffect(event) !== 'ignore') close(true);
      // A sign-in hint cannot confer authority or unlock a cleared preview.
    },
    async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (closed) throw new PrivateWorkspaceCleared();
      const controller = new AbortController();
      flights.add(controller);
      let interrupt: () => void = () => {};
      const interrupted = new Promise<never>((_, reject) => {
        interrupt = () => reject(new PrivateWorkspaceCleared());
      });
      controller.signal.addEventListener('abort', interrupt, { once: true });
      try {
        const pending = Promise.resolve().then(() => {
          if (closed) throw new PrivateWorkspaceCleared();
          return task(controller.signal);
        });
        const result = await Promise.race([pending, interrupted]);
        if (closed) throw new PrivateWorkspaceCleared();
        return result;
      } catch (error) {
        if (closed) throw new PrivateWorkspaceCleared();
        if (
          error &&
          typeof error === 'object' &&
          'status' in error &&
          (error.status === 401 || error.status === 403)
        ) {
          close(true);
          throw new PrivateWorkspaceCleared();
        }
        throw error;
      } finally {
        controller.signal.removeEventListener('abort', interrupt);
        flights.delete(controller);
      }
    },
  };
}
