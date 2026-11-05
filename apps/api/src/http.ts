import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_V2_DRAFT_BYTES = 128 * 1024;
const MAX_IMPORT_PREVIEW_BYTES = 256 * 1024;
const V2_DRAFT_PATH =
  /^\/v2\/staff\/listings\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\/drafts\/([1-9]\d*)$/;
type Handler = (request: Request) => Promise<Response>;
type UploadHandler = (request: Request, source: AsyncIterable<Uint8Array>) => Promise<Response>;
const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const V2_CREATION_PATH = new RegExp(`^/v2/staff/listings/${UUID}/creation-operations/${UUID}$`);
const V2_SUCCESSOR_PATH = new RegExp(`^/v2/staff/listings/${UUID}/revision-operations/${UUID}$`);
const REFERENCE_DRAFT_PATH = new RegExp(
  `^/v3/staff/listings/${UUID.toLowerCase()}/reference-draft-operations/${UUID.toLowerCase()}$`,
);
const REFERENCE_TRANSITION_PATH = new RegExp(
  `^/v3/staff/listings/${UUID.toLowerCase()}/reference-transition-operations/${UUID.toLowerCase()}$`,
);
const REFERENCE_SUCCESSOR_PATH = new RegExp(
  `^/v3/staff/listings/${UUID.toLowerCase()}/reference-successor-operations/${UUID.toLowerCase()}$`,
);
const REFERENCE_CREATION_PATH = new RegExp(
  `^/v3/staff/listings/${UUID.toLowerCase()}/reference-creation-operations/${UUID.toLowerCase()}$`,
);
const V2_UPLOAD_PATH = new RegExp(
  `^/v2/staff/listings/${UUID}/revisions/([1-9]\\d*)/media-jobs/${UUID}/uploads/${UUID}$`,
);
const V2_PREVIEW_PATH = new RegExp(
  `^/v2/staff/listings/${UUID}/revisions/([1-9][0-9]*)/media/${UUID}/preview$`,
);
const V2_REVIEW_PREVIEW_PATH = new RegExp(
  `^/v2/staff/reviews/${UUID}/([1-9][0-9]*)/media/${UUID}/preview$`,
);
const V2_PUBLIC_PHOTO_PATH = new RegExp(
  `^/v2/public/listings/${UUID}/revisions/([1-9][0-9]*)/photos/${UUID}/${UUID}\\.webp$`,
);
function previewPath(incoming: IncomingMessage): boolean {
  const match =
    V2_PREVIEW_PATH.exec(incoming.url ?? '') ??
    V2_REVIEW_PREVIEW_PATH.exec(incoming.url ?? '') ??
    V2_PUBLIC_PHOTO_PATH.exec(incoming.url ?? '');
  return !!match && Number(match[1]) <= 2147483647;
}
function uploadPath(incoming: IncomingMessage): boolean {
  if (incoming.method !== 'GET' && incoming.method !== 'PUT') return false;
  const match = V2_UPLOAD_PATH.exec(incoming.url ?? '');
  return !!match && Number(match[1]) <= 2147483647;
}
const FLOOR_INPUT_PATH =
  /^\/v2\/staff\/listings\/([0-9a-f-]{36})\/floor-plan-inputs\/([1-9][0-9]{0,9})\/([1-9][0-9]{0,15})\/([0-9a-f-]{36})$/;
const FLOOR_IMAGE_PATH =
  /^\/v2\/staff\/listings\/([0-9a-f-]{36})\/floor-plan-images\/([1-9][0-9]{0,9})\/([0-9a-f-]{36})$/;
function floorPlanCandidate(incoming: IncomingMessage): boolean {
  const raw = incoming.url ?? '';
  try {
    return /floor-plan-(?:inputs|images)/i.test(
      decodeURIComponent(new URL(raw, 'http://127.0.0.1').pathname),
    );
  } catch {
    return /floor-plan-/i.test(raw);
  }
}
const FLOOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function floorPlanPath(incoming: IncomingMessage): boolean {
  const raw = incoming.url ?? '',
    m = FLOOR_INPUT_PATH.exec(raw) ?? FLOOR_IMAGE_PATH.exec(raw);
  return (
    !!m && FLOOR_UUID.test(m[1]!) && FLOOR_UUID.test(m[m.length - 1]!) && Number(m[2]) <= 2147483647
  );
}
/** Loopback development bridge. Only the socket address supplies the limiter key. */
export function createDevelopmentServer(
  handler: Handler,
  clientAddresses: WeakMap<Request, string> = new WeakMap(),
  uploadHandler?: UploadHandler,
  previewHandler?: Handler,
  floorPlanHandler?: UploadHandler,
) {
  const dispatch = async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    let streaming = false;
    let cleanup: () => void = () => undefined;
    try {
      const hosts: string[] = [];
      for (let i = 0; i < incoming.rawHeaders.length; i += 2)
        if (incoming.rawHeaders[i]?.toLowerCase() === 'host')
          hosts.push(incoming.rawHeaders[i + 1] ?? '');
      const host = hosts[0];
      if (hosts.length !== 1 || !host || /[\s/\\?#@,]/.test(host)) {
        outgoing.writeHead(400, { Connection: 'close' });
        outgoing.end();
        return;
      }
      const method = incoming.method ?? 'GET';
      const privatePreview = previewHandler !== undefined && previewPath(incoming);
      const floorPlan = floorPlanHandler !== undefined && floorPlanCandidate(incoming);
      const streamHandler = floorPlan
        ? floorPlanHandler
        : uploadHandler && uploadPath(incoming)
          ? uploadHandler
          : undefined;
      const url = new URL(incoming.url ?? '/', `http://${host}`);
      const headers = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
        const key = incoming.rawHeaders[i];
        const value = incoming.rawHeaders[i + 1];
        // Appending all raw values retains ambiguous credentials for fail-closed parsing.
        if (key && value !== undefined) headers.append(key, value);
      }
      // Match the unnormalized incoming target before any ordinary handler can
      // turn an alias into an authorized image request. Read no request body.
      if (previewHandler && privatePreview) {
        streaming = true;
        if (headers.has('expect')) {
          await sendResponse(
            incoming,
            outgoing,
            new Response(JSON.stringify({ error: 'EXPECTATION_FAILED' }), {
              status: 417,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            }),
            true,
          );
          return;
        }
        const controller = new AbortController();
        const onAborted = () => controller.abort();
        const onClose = () => {
          if (!outgoing.writableFinished) controller.abort();
        };
        incoming.on('aborted', onAborted);
        incoming.on('error', onAborted);
        outgoing.on('close', onClose);
        cleanup = () => {
          incoming.off('aborted', onAborted);
          incoming.off('error', onAborted);
          outgoing.off('close', onClose);
        };
        if (incoming.aborted || (outgoing.destroyed && !outgoing.writableFinished))
          controller.abort();
        const request = new Request(url, { method, headers, signal: controller.signal });
        clientAddresses.set(request, incoming.socket.remoteAddress ?? 'unknown-socket');
        const response = await previewHandler(request);
        await sendResponse(incoming, outgoing, response, true);
        return;
      }
      if (streamHandler) {
        if (floorPlan && !floorPlanPath(incoming)) {
          streaming = true;
          await sendResponse(
            incoming,
            outgoing,
            new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            }),
            true,
          );
          return;
        }
        streaming = true;
        if (headers.has('expect')) {
          await sendResponse(
            incoming,
            outgoing,
            new Response(JSON.stringify({ error: 'EXPECTATION_FAILED' }), {
              status: 417,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            }),
            true,
          );
          return;
        }
        const controller = new AbortController();
        const onAborted = () => controller.abort();
        const onClose = () => {
          if (!outgoing.writableFinished) controller.abort();
        };
        incoming.on('aborted', onAborted);
        incoming.on('error', onAborted);
        outgoing.on('close', onClose);
        cleanup = () => {
          incoming.off('aborted', onAborted);
          incoming.off('error', onAborted);
          outgoing.off('close', onClose);
        };
        if (incoming.aborted || (outgoing.destroyed && !outgoing.writableFinished))
          controller.abort();
        // No binary body is consumed or attached to this headers-only request.
        // The hook must complete verified authorization/admission before iterating.
        const request = new Request(url, { method, headers, signal: controller.signal });
        const source: AsyncIterable<Uint8Array> = {
          [Symbol.asyncIterator]() {
            return incoming.iterator({ destroyOnReturn: false }) as AsyncIterator<Uint8Array>;
          },
        };
        clientAddresses.set(request, incoming.socket.remoteAddress ?? 'unknown-socket');
        const response = await streamHandler(request, source);
        await sendResponse(incoming, outgoing, response, true);
        return;
      }
      // Match raw canonical targets before granting each contract's bounded allowance.
      const draft = method === 'PUT' && url.search === '' ? V2_DRAFT_PATH.exec(url.pathname) : null;
      const creation =
        method === 'POST' &&
        url.search === '' &&
        (V2_CREATION_PATH.test(incoming.url ?? '') || V2_SUCCESSOR_PATH.test(incoming.url ?? ''));
      const reference =
        method === 'POST' &&
        incoming.url === url.pathname &&
        (REFERENCE_DRAFT_PATH.test(url.pathname) ||
          REFERENCE_TRANSITION_PATH.test(url.pathname) ||
          REFERENCE_SUCCESSOR_PATH.test(url.pathname) ||
          REFERENCE_CREATION_PATH.test(url.pathname));
      const maximum =
        method === 'POST' && incoming.url === '/v2/staff/listing-import-preview'
          ? MAX_IMPORT_PREVIEW_BYTES
          : creation || reference || (draft && Number(draft[1]) <= 2147483647)
            ? MAX_V2_DRAFT_BYTES
            : MAX_BODY_BYTES;
      const body = await readBody(incoming, maximum);
      const request = new Request(url, {
        method,
        headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: Uint8Array.from(body).buffer }),
      });
      clientAddresses.set(request, incoming.socket.remoteAddress ?? 'unknown-socket');
      const response = await handler(request);
      await sendResponse(incoming, outgoing, response, false);
    } catch (error) {
      const status = error instanceof BodyTooLarge ? 413 : 400;
      if (!outgoing.headersSent && !outgoing.destroyed)
        await sendResponse(
          incoming,
          outgoing,
          new Response(
            JSON.stringify({ error: status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST' }),
            {
              status,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            },
          ),
          streaming,
        );
    } finally {
      cleanup();
    }
  };
  const server = createServer((incoming, outgoing) => {
    void dispatch(incoming, outgoing);
  });
  // Node otherwise sends 100 automatically before the application sees the body.
  server.on('checkContinue', (incoming, outgoing) => {
    if (floorPlanHandler && floorPlanCandidate(incoming)) {
      void dispatch(incoming, outgoing);
      return;
    }
    if (previewHandler && previewPath(incoming)) {
      void dispatch(incoming, outgoing);
      return;
    }
    if (uploadHandler && uploadPath(incoming)) {
      void dispatch(incoming, outgoing);
      return;
    }
    outgoing.writeContinue();
    void dispatch(incoming, outgoing);
  });
  server.on('checkExpectation', (incoming, outgoing) => {
    if (floorPlanHandler && floorPlanCandidate(incoming)) {
      void dispatch(incoming, outgoing);
      return;
    }
    if (previewHandler && previewPath(incoming)) {
      void dispatch(incoming, outgoing);
      return;
    }
    if (uploadHandler && uploadPath(incoming)) {
      void dispatch(incoming, outgoing);
      return;
    }
    outgoing.writeHead(417);
    outgoing.end();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server;
}
async function sendResponse(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  response: Response,
  streaming: boolean,
): Promise<void> {
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (outgoing.destroyed) return;
  if (streaming && !incoming.readableEnded) {
    responseHeaders.connection = 'close';
    outgoing.shouldKeepAlive = false;
    incoming.pause();
    // Finish the denial response before terminating an unread/partly read body.
    // Do not drain an unbounded unauthorized stream or destroy before sending.
    outgoing.once('finish', () => incoming.destroy());
  }
  if (!streaming) {
    outgoing.writeHead(response.status, responseHeaders);
    outgoing.end(bytes);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const clean = () => {
      outgoing.off('finish', finish);
      outgoing.off('close', finish);
      outgoing.off('error', failed);
    };
    const finish = () => {
      clean();
      resolve();
    };
    const failed = (error: Error) => {
      clean();
      reject(error);
    };
    outgoing.once('finish', finish);
    outgoing.once('close', finish);
    outgoing.once('error', failed);
    try {
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(bytes);
    } catch (error) {
      clean();
      reject(error);
    }
  });
}
class BodyTooLarge extends Error {}
async function readBody(incoming: IncomingMessage, maximum: number): Promise<Buffer> {
  const declared = incoming.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new BodyTooLarge();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const raw of incoming) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    length += chunk.length;
    if (length > maximum) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
