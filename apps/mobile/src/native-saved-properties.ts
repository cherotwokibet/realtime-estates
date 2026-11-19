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
      return Object.freeze({
        phase: active ? phase : 'idle',
        page: active ? page : null,
        pageNumber: active ? pageNumber : 1,
      });
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
      reset();
      publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      unsubscribe();
      publish();
      listeners.clear();
    },
  });
}
export type NativeSavedPropertiesController = ReturnType<typeof createNativeSavedProperties>;
