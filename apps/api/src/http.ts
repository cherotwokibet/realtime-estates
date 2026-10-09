import { createServer, type IncomingMessage } from 'node:http';
const MAX_BODY_BYTES = 64 * 1024;
type Handler = (request: Request) => Promise<Response>;
/** Loopback development bridge. Only the socket address supplies the limiter key. */
export function createDevelopmentServer(handler: Handler, clientAddresses: WeakMap<Request,string> = new WeakMap()) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const host = incoming.headers.host;
      if (!host || /[\s/\\?#@,]/.test(host)) { outgoing.writeHead(400); outgoing.end(); return; }
      const body = await readBody(incoming);
      const headers = new Headers();
      for (let i=0;i<incoming.rawHeaders.length;i+=2) {
        const key = incoming.rawHeaders[i]; const value = incoming.rawHeaders[i+1];
        if (key && value) headers.append(key,value);
      }
      const method = incoming.method ?? 'GET';
      const request = new Request(new URL(incoming.url ?? '/', `http://${host}`), {
        method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body:Uint8Array.from(body).buffer }),
      });
      clientAddresses.set(request,incoming.socket.remoteAddress ?? 'unknown-socket');
      const response = await handler(request);
      const responseHeaders:Record<string,string>={};
      response.headers.forEach((value,key)=>{responseHeaders[key]=value;});
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const status = error instanceof BodyTooLarge ? 413 : 400;
      outgoing.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      outgoing.end(JSON.stringify({error:status===413?'BODY_TOO_LARGE':'INVALID_REQUEST'}));
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000; server.maxHeadersCount = 50;
  return server;
}
class BodyTooLarge extends Error {}
async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const declared = incoming.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared)>MAX_BODY_BYTES)) throw new BodyTooLarge();
  const chunks: Buffer[] = []; let length=0;
  for await (const raw of incoming) {
    const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw); length+=chunk.length;
    if(length>MAX_BODY_BYTES) throw new BodyTooLarge(); chunks.push(chunk);
  }
  return Buffer.concat(chunks,length);
}
