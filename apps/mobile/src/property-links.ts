import { propertyLinkPathPrefix } from '@realtor/domain';
import {
  loadMobileReferenceCatalogue,
  type MobileReferenceConfig,
  type MobileReferenceItem,
} from './reference-catalogue.ts';

type ConnectedConfig = Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function linkedPropertyId(origin: string, url: string | null): string | null {
  const prefix = origin + propertyLinkPathPrefix;
  if (!url?.startsWith(prefix)) return null;
  const id = url.slice(prefix.length);
  return id.length === 36 && uuid.test(id) ? id : null;
}

type PropertyLinkResult =
  { status: 'found'; item: MobileReferenceItem } | { status: 'unavailable' } | { status: 'error' };

export async function readLinkedProperty(
  config: ConnectedConfig,
  id: string,
  signal: AbortSignal,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<PropertyLinkResult> {
  const result = await loadMobileReferenceCatalogue(config, {
    search: { id, limit: 1 },
    signal,
    fetch: (input, init) => fetcher(input, { ...init, cache: 'no-store' }),
  });
  if (result.status === 'error' || signal.aborted) return { status: 'error' };
  const [item] = result.items;
  if (result.searchPage?.total === 0 && !item) return { status: 'unavailable' };
  if (result.searchPage?.total !== 1 || result.items.length !== 1 || item?.property.id !== id)
    return { status: 'error' };
  return { status: 'found', item };
}

export type PropertyLinkState =
  { status: 'loading'; id: string } | (PropertyLinkResult & { id: string });

type LinkingSource = {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: 'url', callback: (event: { url: string }) => void): { remove(): void };
};

export function listenForPropertyLinks(
  source: LinkingSource,
  origin: string,
  read: (id: string, signal: AbortSignal) => Promise<PropertyLinkResult>,
  update: (state: PropertyLinkState | null) => void,
) {
  let initialAllowed = true;
  let active = true;
  let pending: AbortController | undefined;
  const open = (id: string) => {
    pending?.abort();
    const request = new AbortController();
    pending = request;
    update({ status: 'loading', id });
    void read(id, request.signal).then(
      (result) => {
        if (active && !request.signal.aborted) update({ ...result, id });
      },
      () => {
        if (active && !request.signal.aborted) update({ status: 'error', id });
      },
    );
  };
  const receive = (url: string | null) => {
    const id = linkedPropertyId(origin, url);
    if (!active || !id) return;
    initialAllowed = false;
    open(id);
  };
  const subscription = source.addEventListener('url', ({ url }) => receive(url));
  void source.getInitialURL().then(
    (url) => {
      if (initialAllowed) receive(url);
    },
    () => {},
  );
  return {
    retry: open,
    dismiss() {
      initialAllowed = false;
      pending?.abort();
      update(null);
    },
    stop() {
      active = false;
      pending?.abort();
      subscription.remove();
    },
  };
}
