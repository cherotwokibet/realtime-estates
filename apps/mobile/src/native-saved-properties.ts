import {
  propertyLinkOrigin,
  propertyLinkPathPrefix,
  validateCustomerFavouritesPage,
  type CustomerFavouritesPage,
} from '@realtor/domain';
import type { MobileCustomerSession } from './customer-session.ts';

/** One private page in memory, never a synthetic catalogue join or a client-supplied cursor. */
export function createNativeSavedProperties(
  session: MobileCustomerSession,
  links?: string,
  timeoutMs = 12000,
  operationId?: () => string,
) {
  const origin = links === undefined ? null : propertyLinkOrigin(links).origin;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw Error('Saved properties unavailable.');
  let phase: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';
  let page: CustomerFavouritesPage | null = null,
    after: string | null = null,
    pageNumber = 1;
  let pending: AbortController | null = null,
    disposed = false,
    revision = 0,
    observed = session.revision();
  let removalFailed = false,
    viewGeneration = 0;
  const listeners = new Set<() => void>();
  const publish = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  function reset() {
    const old = pending;
    pending = null;
    old?.abort();
    page = null;
    after = null;
    pageNumber = 1;
    phase = 'idle';
  }
  const unsubscribe = session.subscribe(() => {
    observed = session.revision();
    removalFailed = false;
    reset();
    publish();
  });
  function ready() {
    const snapshot = session.snapshot();
    if (
      disposed ||
      snapshot.status !== 'ready' ||
      snapshot.phase !== 'idle' ||
      observed !== session.revision()
    ) {
      observed = session.revision();
      reset();
      return null;
    }
    return snapshot;
  }
  async function read(cursor: string | null, number: number) {
    const scope = ready();
    if (!scope || pending) return false;
    const controller = new AbortController();
    pending = controller;
    removalFailed = false;
    page = null;
    after = cursor;
    pageNumber = number;
    phase = 'loading';
    const expectedRevision = session.revision();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    publish();
    try {
      const value = await session.list(
        { limit: 20, ...(cursor ? { after: cursor } : {}) },
        controller.signal,
      );
      if (
        pending !== controller ||
        controller.signal.aborted ||
        !ready() ||
        expectedRevision !== session.revision()
      )
        return false;
      if (!value) {
        phase = 'unavailable';
        return false;
      }
      page = validateCustomerFavouritesPage(
        value,
        { tenantId: scope.account.tenantId, customerId: scope.account.customerId },
        20,
        cursor,
      );
      phase = 'ready';
      return true;
    } catch {
      if (pending === controller && ready()) phase = 'unavailable';
      return false;
    } finally {
      clearTimeout(timer);
      if (pending === controller) {
        pending = null;
        if (phase === 'loading') phase = 'unavailable';
        publish();
      }
    }
  }
  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    snapshot() {
      const active = ready();
      const account = session.snapshot();
      const operation =
        account.status !== 'ready'
          ? 'none'
          : account.phase === 'settled'
            ? account.receipt?.outcome === 'conflict' || account.receipt?.saved
              ? 'conflict'
              : 'removed'
            : account.phase === 'idle'
              ? removalFailed
                ? 'rejected'
                : 'none'
              : account.phase;
      return Object.freeze({
        phase: active ? phase : 'idle',
        page: active ? page : null,
        pageNumber: active ? pageNumber : 1,
        operation,
        removalEnabled: operationId !== undefined,
      });
    },
    async remove(listingId: string, expectedRevision: number) {
      const scope = ready();
      if (
        !operationId ||
        !scope ||
        pending ||
        removalFailed ||
        expectedRevision !== revision ||
        phase !== 'ready'
      )
        return false;
      const item = page?.items.find((row) => row.listingId === listingId);
      if (!item) return false;
      const localView = viewGeneration;
      try {
        const accepted = await session.save({
          policy: 'customer-favourite-command-v1',
          operationId: operationId(),
          listingId: item.listingId,
          expectedVersion: item.version,
          saved: false,
        });
        const current = session.snapshot();
        if (
          !accepted &&
          !disposed &&
          viewGeneration === localView &&
          current.status === 'ready' &&
          current.activation === scope.activation &&
          current.phase === 'idle'
        ) {
          removalFailed = true;
          publish();
        }
        return accepted;
      } catch {
        if (!disposed && viewGeneration === localView && session.snapshot().status === 'ready') {
          removalFailed = true;
          publish();
        }
        return false;
      }
    },
    recoverRemoval(expectedRevision: number) {
      const state = session.snapshot();
      return !disposed &&
        revision === expectedRevision &&
        state.status === 'ready' &&
        state.phase === 'uncertain'
        ? session.recover()
        : Promise.resolve(false);
    },
    retryRemoval(expectedRevision: number) {
      const state = session.snapshot();
      return !disposed &&
        revision === expectedRevision &&
        state.status === 'ready' &&
        state.phase === 'missing'
        ? session.retry()
        : Promise.resolve(false);
    },
    async continueRemoval(expectedRevision: number) {
      if (disposed || revision !== expectedRevision || !session.settle()) return false;
      return read(null, 1);
    },
    first: () => read(null, 1),
    reload: () => read(after, pageNumber),
    next() {
      if (
        !ready() ||
        pending ||
        phase !== 'ready' ||
        !page?.hasMore ||
        pageNumber >= Number.MAX_SAFE_INTEGER
      )
        return Promise.resolve(false);
      return read(page.items[page.items.length - 1]!.listingId, pageNumber + 1);
    },
    propertyUrl(listingId: string) {
      if (
        !ready() ||
        phase !== 'ready' ||
        !origin ||
        !page?.items.some((item) => item.listingId === listingId && item.available)
      )
        return null;
      return origin + propertyLinkPathPrefix + listingId;
    },
    hide() {
      viewGeneration++;
      removalFailed = false;
      reset();
      publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      viewGeneration++;
      removalFailed = false;
      reset();
      unsubscribe();
      publish();
      listeners.clear();
    },
  });
}
export type NativeSavedPropertiesController = ReturnType<typeof createNativeSavedProperties>;
