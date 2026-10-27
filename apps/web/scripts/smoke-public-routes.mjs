import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(webDirectory, '../..');
const nextBinary = resolve(repositoryDirectory, 'node_modules/next/dist/bin/next');

async function getEphemeralPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitForServer(server, baseUrl, readLogs) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited with ${server.exitCode}: ${readLogs()}`);
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_500) });
      if (response.status === 200) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for Next.js: ${readLogs()}`);
}

async function main() {
  const port = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [nextBinary, 'start', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: webDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        TENANT_SLUG: 'realtime-estates',
        WEB_CATALOGUE_MODE: 'demo',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  server.stdout.on('data', (chunk) => (logs += chunk.toString()));
  server.stderr.on('data', (chunk) => (logs += chunk.toString()));

  try {
    await waitForServer(server, `${baseUrl}/`, () => logs);
    const routes = [
      ['home and rent/buy results', '/', 'Homes to rent'],
      ['property details', '/properties/demo-ruaka-1', 'Property details'],
      ['company', '/company', 'Company'],
      ['contact', '/contact', 'Contact'],
      ['synthetic agent profile', '/agents/sample-advisor-realtime', 'Sample property advisor'],
    ];
    const results = [];
    for (const [name, path, expectedText] of routes) {
      const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
      const html = await response.text();
      assert.equal(response.status, 200, `${name} should render successfully`);
      assert.match(html, /<main id="main"/, `${name} should expose the main landmark`);
      assert.ok(html.includes(expectedText), `${name} should include its expected content`);
      assert.ok(
        html.includes('noindex'),
        `${name} should remain excluded from indexing in preview`,
      );
      results.push({ name, status: response.status, mainLandmark: true, noindex: true });
    }
    const styles = await readFile(resolve(webDirectory, 'app/styles.css'), 'utf8');
    assert.match(
      styles,
      /@media\s*\(max-width:\s*800px\)/,
      'tablet layout breakpoint should exist',
    );
    assert.match(
      styles,
      /@media\s*\(max-width:\s*580px\)/,
      'small-screen layout breakpoint should exist',
    );
    assert.match(styles, /\.property-grid\s*\{/, 'result grid rules should exist');
    assert.match(styles, /\.detail-page\s*\{/, 'detail page layout rules should exist');
    console.log(
      JSON.stringify(
        {
          tenant: 'synthetic realtime-estates',
          routeCount: results.length,
          routes: results,
          responsiveCss: ['800px', '580px'],
          note: 'HTTP/server-render smoke only; not a visual or device check.',
        },
        null,
        2,
      ),
    );
  } finally {
    if (server.exitCode === null) server.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
