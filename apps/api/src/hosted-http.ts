import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isHostedApiPath } from './hosted-api.js';
class EnvelopeError extends Error {
  constructor(readonly status: number) {
    super('Invalid staging request.');
  }
}
/** Cloud Run terminates HTTPS. Only configured Host supplies the canonical origin; forwarded identities are ignored/refused. */
export function createHostedApiServer(
  origin: string,
  handler: (request: Request) => Promise<Response>,
) {
  const configured = new URL(origin);
  if (configured.protocol !== 'https:' || configured.origin !== origin)
    throw Error('HTTPS staging origin required.');
  async function dispatch(incoming: IncomingMessage, outgoing: ServerResponse) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    incoming.once('aborted', abort);
    incoming.once('error', abort);
    const closed = () => {
      if (!outgoing.writableFinished) abort();
    };
    outgoing.once('close', closed);
    try {
      const counts = new Map<string, number>();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
        const name = incoming.rawHeaders[i]!.toLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      if (
        counts.get('host') !== 1 ||
        incoming.headers.host !== configured.host ||
        (counts.get('authorization') ?? 0) > 1
      )
        throw new EnvelopeError(400);
      const raw = incoming.url ?? '';
      if (!raw.startsWith('/') || raw.startsWith('//') || /[\\#\s]/.test(raw) || raw.length > 2048)
        throw new EnvelopeError(400);
      const url = new URL(raw, origin);
      if (url.origin !== origin || url.pathname + url.search !== raw || /%/.test(url.pathname))
        throw new EnvelopeError(400);
      const method = incoming.method ?? 'GET';
      const health = raw === '/healthz';
      if (!health && !isHostedApiPath(url.pathname)) throw new EnvelopeError(404);
      if (!['GET', 'POST'].includes(method) || (health && method !== 'GET'))
        throw new EnvelopeError(405);
      for (const name of Object.keys(incoming.headers))
        if (
          name.startsWith('if-') ||
          [
            'cookie',
            'x-actor-id',
            'x-tenant-id',
            'x-role',
            'x-company-id',
            'x-preview-instance',
            'x-assigned-agent-id',
            'expect',
            'range',
            'idempotency-key',
            'content-encoding',
            'transfer-encoding',
          ].includes(name)
        )
          throw new EnvelopeError(400);
      if (incoming.headers.origin !== undefined && incoming.headers.origin !== origin)
        throw new EnvelopeError(403);
      if (incoming.headers['sec-fetch-site'] === 'cross-site') throw new EnvelopeError(403);
      const post = method === 'POST',
        length = incoming.headers['content-length'];
      if (post) {
        if (
          incoming.headers['content-type'] !== 'application/json' ||
          typeof length !== 'string' ||
          !/^[1-9][0-9]{0,3}$/.test(length) ||
          Number(length) > 8192
        )
          throw new EnvelopeError(413);
      } else if (length !== undefined || incoming.headers['content-type'] !== undefined)
        throw new EnvelopeError(400);
      if (health) {
        outgoing.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        outgoing.end('{"status":"ok"}');
        return;
      }
      const headers = new Headers();
      // Cloud proxy routing/trace headers never become tenant/actor authority or core API context.
      for (const name of ['authorization', 'content-type', 'content-length', 'accept']) {
        const value = incoming.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      let body: Uint8Array<ArrayBuffer> | undefined;
      if (post) {
        const bytes: Buffer[] = [];
        let size = 0;
        const timer = setTimeout(() => {
          abort();
          incoming.destroy();
        }, 5000);
        try {
          for await (const part of incoming) {
            size += part.length;
            if (size > 8192) throw new EnvelopeError(413);
            bytes.push(Buffer.from(part));
          }
        } finally {
          clearTimeout(timer);
        }
        if (size !== Number(length)) throw new EnvelopeError(400);
        body = new Uint8Array(Buffer.concat(bytes));
      }
      if (controller.signal.aborted) throw new EnvelopeError(408);
      const response = await handler(
        new Request(url, { method, headers, signal: controller.signal, ...(body ? { body } : {}) }),
      );
      const responseBytes = Buffer.from(await response.arrayBuffer());
      if (responseBytes.length > 262144) throw new EnvelopeError(503);
      if (!outgoing.destroyed) {
        const result: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          result[k] = v;
        });
        outgoing.writeHead(response.status, result);
        outgoing.end(responseBytes);
      }
    } catch (e) {
      if (!outgoing.destroyed && !outgoing.headersSent) {
        outgoing.shouldKeepAlive = false;
        outgoing.writeHead(e instanceof EnvelopeError ? e.status : 503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          Connection: 'close',
        });
        outgoing.end(
          '{"error":{"code":"REQUEST_UNAVAILABLE","message":"Staging API request unavailable."}}',
        );
      }
    } finally {
      incoming.off('aborted', abort);
      incoming.off('error', abort);
      outgoing.off('close', closed);
    }
  }
  const server = createServer((req, res) => void dispatch(req, res));
  server.on('checkContinue', (_req, res) => {
    res.writeHead(417, { Connection: 'close' });
    res.end();
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  return server;
}
