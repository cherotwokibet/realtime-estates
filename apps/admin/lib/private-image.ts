import type { StaffDraftWorkspaceV2 } from '@realtor/api-client';

export interface PrivateImageTuple {
  readonly instanceId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly version: string;
  readonly mediaId: string;
}
export interface PrivateImageState {
  readonly key: string;
  readonly mediaId: string;
  readonly phase: 'loading' | 'ready' | 'unavailable' | 'stale';
  readonly url: string | null;
}
export interface PrivateImageBatch {
  start(): void;
  decodeFailed(mediaId: string, url: string): void;
  close(): void;
}
interface Options {
  onState: (state: PrivateImageState) => void;
  onStale: (tuple: PrivateImageTuple) => void;
  onDenied?: (tuple: PrivateImageTuple) => void;
  fetch?: (path: string, options: RequestInit) => Promise<Response>;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  timeoutMs?: number;
}
const MAX_BYTES = 10485760,
  MAX_PHOTOS = 12;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const privateImageKey = (tuple: PrivateImageTuple) =>
  JSON.stringify([tuple.instanceId, tuple.listingId, tuple.revision, tuple.version, tuple.mediaId]);
function tuple(value: PrivateImageTuple): PrivateImageTuple {
  if (
    !UUID.test(value.instanceId) ||
    !UUID.test(value.listingId) ||
    !UUID.test(value.mediaId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    value.revision > 2147483647 ||
    !/^[1-9]\d{0,15}$/.test(value.version) ||
    BigInt(value.version) > 9007199254740991n
  )
    throw new Error('Invalid private image scope.');
  return Object.freeze({
    instanceId: value.instanceId,
    listingId: value.listingId,
    revision: value.revision,
    version: value.version,
    mediaId: value.mediaId,
  });
}
/** Proposed order and raw text never select an image version. Legacy fixtures perform no reads. */
export function privateGalleryScope(
  workspace: StaffDraftWorkspaceV2,
  instanceId: string,
  enabled: boolean,
): Readonly<{ key: string; resources: readonly PrivateImageTuple[] }> {
  if (workspace.photos.length > MAX_PHOTOS) throw new Error('Too many private photos.');
  const resources =
    enabled && workspace.draft.state === 'draft'
      ? workspace.photos
          .filter((photo) => photo.accepted && photo.provenance === 'sealed')
          .map((photo) =>
            tuple({
              instanceId,
              listingId: workspace.listingId,
              revision: workspace.draft.revision,
              version: workspace.draft.version,
              mediaId: photo.id,
            }),
          )
      : [];
  if (new Set(resources.map((resource) => resource.mediaId)).size !== resources.length)
    throw new Error('Repeated private photo.');
  // Saved order is not a transport dependency. Reordering local cards does not refetch.
  const key = JSON.stringify([
    instanceId,
    workspace.listingId,
    workspace.draft.revision,
    workspace.draft.version,
    workspace.draft.state,
    enabled,
    ...resources.map((resource) => resource.mediaId).sort(),
  ]);
  return Object.freeze({ key, resources: Object.freeze(resources) });
}
class ImageFailure extends Error {
  constructor(
    readonly stale = false,
    readonly denied = false,
  ) {
    super('Private image unavailable.');
  }
}
async function collect(
  response: Response,
  resource: PrivateImageTuple,
  signal: AbortSignal,
  deadline: number,
  aborted: Promise<never>,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  const check = () => {
    if (signal.aborted || performance.now() >= deadline) throw new ImageFailure();
  };
  try {
    check();
    if (response.status === 409) throw new ImageFailure(true);
    if ([401, 403, 404].includes(response.status)) throw new ImageFailure(false, true);
    const expectedPath = `/api/staff/drafts/${resource.listingId}/${resource.revision}/media/${resource.mediaId}/preview`;
    if (response.redirected || response.headers.has('content-range')) throw new ImageFailure();
    if (response.url) {
      const actual = new URL(response.url);
      if (
        actual.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(actual.hostname) ||
        actual.pathname !== expectedPath ||
        actual.search ||
        actual.hash ||
        actual.username ||
        actual.password ||
        (typeof location !== 'undefined' && actual.origin !== location.origin)
      )
        throw new ImageFailure();
    }
    const declared = response.headers.get('content-length');
    if (
      response.status !== 200 ||
      response.headers.get('content-type') !== 'image/webp' ||
      response.headers.get('x-revision-version') !== resource.version ||
      !declared ||
      !/^[1-9]\d*$/.test(declared) ||
      Number(declared) > MAX_BYTES ||
      response.headers.has('content-encoding') ||
      !reader
    )
      throw new ImageFailure();
    const expected = Number(declared),
      bytes = new Uint8Array(expected);
    let length = 0;
    for (;;) {
      check();
      const item = await Promise.race([reader.read(), aborted]);
      check();
      if (item.done) break;
      if (
        !(item.value instanceof Uint8Array) ||
        (typeof SharedArrayBuffer !== 'undefined' &&
          item.value.buffer instanceof SharedArrayBuffer) ||
        item.value.byteLength > expected - length
      )
        throw new ImageFailure();
      if (item.value.byteLength) {
        bytes.set(item.value, length);
        length += item.value.byteLength;
      }
    }
    if (
      length !== expected ||
      length < 20 ||
      bytes[0] !== 82 ||
      bytes[1] !== 73 ||
      bytes[2] !== 70 ||
      bytes[3] !== 70 ||
      bytes[8] !== 87 ||
      bytes[9] !== 69 ||
      bytes[10] !== 66 ||
      bytes[11] !== 80 ||
      new DataView(bytes.buffer).getUint32(4, true) !== length - 8
    )
      throw new ImageFailure();
    return bytes;
  } finally {
    if (reader) {
      void reader.cancel().catch(() => undefined);
      try {
        reader.releaseLock();
      } catch {
        /* A cancelled pending read may still own its lock. */
      }
    }
  }
}
/** One read per saved tuple, two concurrent reads, owned URLs, and no implicit retry. */
export function createPrivateImageBatch(
  values: readonly PrivateImageTuple[],
  options: Options,
): PrivateImageBatch {
  if (values.length > MAX_PHOTOS) throw new Error('Too many private photos.');
  const resources = values.map(tuple),
    first = resources[0];
  if (
    new Set(resources.map((resource) => resource.mediaId)).size !== resources.length ||
    resources.some(
      (resource) =>
        resource.instanceId !== first!.instanceId ||
        resource.listingId !== first!.listingId ||
        resource.revision !== first!.revision ||
        resource.version !== first!.version,
    )
  )
    throw new Error('Repeated or mixed private image scope.');
  const timeoutMs = options.timeoutMs ?? 20000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error('Invalid private image timeout.');
  const fetchImage: NonNullable<Options['fetch']> =
      options.fetch ?? ((path, init) => fetch(path, init)),
    createUrl: NonNullable<Options['createUrl']> =
      options.createUrl ?? ((blob) => URL.createObjectURL(blob)),
    revokeUrl: NonNullable<Options['revokeUrl']> =
      options.revokeUrl ?? ((url) => URL.revokeObjectURL(url));
  const onState = options.onState,
    onStale = options.onStale,
    onDenied = options.onDenied,
    controllers = new Set<AbortController>(),
    urls = new Map<string, string>();
  let started = false,
    closed = false,
    stale = false,
    next = 0,
    active = 0;
  const notify = (
    resource: PrivateImageTuple,
    phase: PrivateImageState['phase'],
    url: string | null = null,
  ) => {
    if (!closed)
      onState(
        Object.freeze({ key: privateImageKey(resource), mediaId: resource.mediaId, phase, url }),
      );
  };
  const revoke = (mediaId: string) => {
    const url = urls.get(mediaId);
    if (url !== undefined) {
      urls.delete(mediaId);
      revokeUrl(url);
    }
  };
  function stopBatch(resource: PrivateImageTuple, phase: 'stale' | 'unavailable') {
    if (closed || stale) return;
    stale = true;
    for (const controller of controllers) controller.abort();
    for (const id of [...urls.keys()]) revoke(id);
    for (const item of resources) notify(item, phase);
    if (phase === 'stale') onStale(resource);
    else onDenied?.(resource);
  }
  async function load(resource: PrivateImageTuple) {
    const controller = new AbortController();
    controllers.add(controller);
    const deadline = performance.now() + timeoutMs;
    let rejectAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new ImageFailure());
    });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const pending = fetchImage(
        `/api/staff/drafts/${resource.listingId}/${resource.revision}/media/${resource.mediaId}/preview`,
        {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'X-Preview-Instance': resource.instanceId,
            'X-Revision-Version': resource.version,
          },
        },
      );
      // An obsolete mock/transport completion must not retain an unread response.
      void pending.then(
        (response) => {
          if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined);
        },
        () => undefined,
      );
      const response = await Promise.race([pending, aborted]),
        bytes = await collect(response, resource, controller.signal, deadline, aborted);
      if (closed || stale || controller.signal.aborted) return;
      const url = createUrl(new Blob([bytes], { type: 'image/webp' }));
      if (closed || stale || controller.signal.aborted) {
        revokeUrl(url);
        return;
      }
      urls.set(resource.mediaId, url);
      notify(resource, 'ready', url);
    } catch (error) {
      if (!closed && !stale) {
        if (error instanceof ImageFailure && error.stale) stopBatch(resource, 'stale');
        else if (error instanceof ImageFailure && error.denied) stopBatch(resource, 'unavailable');
        else {
          revoke(resource.mediaId);
          notify(resource, 'unavailable');
        }
      }
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', rejectAbort);
      controllers.delete(controller);
      active--;
      pump();
    }
  }
  function pump() {
    while (!closed && !stale && active < 2 && next < resources.length) {
      active++;
      void load(resources[next++]!);
    }
  }
  function start() {
    if (started || closed) return;
    started = true;
    for (const resource of resources) notify(resource, 'loading');
    pump();
  }
  function decodeFailed(mediaId: string, url: string) {
    if (closed || stale || urls.get(mediaId) !== url) return;
    revoke(mediaId);
    const resource = resources.find((item) => item.mediaId === mediaId);
    if (resource) notify(resource, 'unavailable');
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const controller of controllers) controller.abort();
    for (const id of [...urls.keys()]) revoke(id);
  }
  return Object.freeze({ start, decodeFailed, close });
}
