/** Loopback-only QA server for the generated acceptance index; no application identity. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
if (process.env.NODE_ENV === 'production') throw Error('Acceptance QA refuses production.');
const docs = new URL('../docs/', import.meta.url);
const data = JSON.parse(await readFile(new URL('acceptance-status.json', docs), 'utf8'));
const allowed = new Map([
  ['/', 'acceptance-status.html'],
  ['/index.html', 'acceptance-status.html'],
  ['/acceptance-status.html', 'acceptance-status.html'],
  ['/acceptance-status.json', 'acceptance-status.json'],
  ['/acceptance-status.md', 'acceptance-status.md'],
  ...Object.values(data.executions).map((record) => {
    const path = record.path.replace(/^docs\//, '');
    return ['/' + path, path];
  }),
]);
const server = createServer(async (request, response) => {
  const name = allowed.get(request.url);
  if (request.method !== 'GET' || !name) {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(new URL(name, docs));
    const type = name.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : name.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8';
    response
      .writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(3122, '127.0.0.1', () =>
  console.log('Acceptance evidence QA: http://127.0.0.1:3122/'),
);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
