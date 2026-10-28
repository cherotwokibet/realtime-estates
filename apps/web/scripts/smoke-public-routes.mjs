import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    TENANT_SLUG: 'realtime-estates',
    WEB_CATALOGUE_MODE: 'demo',
    WEB_CATALOGUE_DATA: 'synthetic',
    WEB_INDEXING: 'disabled',
    WEB_PUBLIC_ORIGIN: 'https://catalogue.synthetic.invalid',
  };
  delete environment.WEB_CATALOGUE_REFERENCE;
  delete environment.WEB_CATALOGUE_SEARCH;
  const server = spawn(
    process.execPath,
    [nextBinary, 'start', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: webDirectory,
      env: environment,
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
    const propertyResponse = await fetch(`${baseUrl}/properties/demo-ruaka-1?tracking=ignored`, {
      headers: {
        'user-agent': 'facebookexternalhit/1.1',
        'x-forwarded-host': 'untrusted.invalid',
        'x-forwarded-proto': 'http',
      },
      signal: AbortSignal.timeout(10000),
    });
    const propertyHtml = await propertyResponse.text();
    assert.match(
      propertyHtml,
      /<link rel="canonical" href="https:\/\/catalogue\.synthetic\.invalid\/properties\/demo-ruaka-1"/,
    );
    assert.match(propertyHtml, /property="og:title"/);
    assert.match(
      propertyHtml,
      /property="og:url" content="https:\/\/catalogue\.synthetic\.invalid\/properties\/demo-ruaka-1"/,
    );
    assert.match(
      propertyHtml,
      /property="og:image" content="https:\/\/catalogue\.synthetic\.invalid\/sharing-card"/,
    );
    assert.match(propertyHtml, /name="twitter:card" content="summary_large_image"/);
    assert.match(propertyHtml, /Synthetic preview\. No real availability/);
    const missing = await fetch(`${baseUrl}/properties/unknown-synthetic-property`, {
      headers: { 'user-agent': 'facebookexternalhit/1.1' },
      signal: AbortSignal.timeout(5000),
    });
    // Next can flush a 200 before notFound resolves; both forms must carry noindex.
    assert.ok([200, 404].includes(missing.status));
    const missingHtml = await missing.text();
    assert.match(missingHtml, /noindex/);
    assert.match(missingHtml, /NEXT_HTTP_ERROR_FALLBACK;404|PAGE NOT FOUND/);
    assert.doesNotMatch(missingHtml, /rel="canonical"/);
    const filtered = await fetch(`${baseUrl}/?beds=0`, { signal: AbortSignal.timeout(5000) });
    const filteredHtml = await filtered.text();
    assert.match(filteredHtml, /noindex/);
    assert.match(
      filteredHtml,
      /<link rel="canonical" href="https:\/\/catalogue\.synthetic\.invalid\/?"/,
    );
    const robots = await fetch(`${baseUrl}/robots.txt`, { signal: AbortSignal.timeout(5000) });
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Disallow: \//);
    const sitemap = await fetch(`${baseUrl}/sitemap.xml`, { signal: AbortSignal.timeout(5000) });
    assert.equal(sitemap.status, 200);
    const sitemapXml = await sitemap.text();
    assert.match(sitemapXml, /<urlset/);
    assert.doesNotMatch(sitemapXml, /<loc>/);
    const card = await fetch(`${baseUrl}/sharing-card`, { signal: AbortSignal.timeout(15000) });
    assert.equal(card.status, 200);
    assert.match(card.headers.get('content-type'), /image\/png/);
    const png = Buffer.from(await card.arrayBuffer());
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    assert.ok(png.length < 5 * 1024 * 1024);
    const forgedCard = await fetch(`${baseUrl}/sharing-card?tenant=sample-homes`, {
      headers: { 'x-tenant-id': 'sample-homes', 'x-forwarded-host': 'untrusted.invalid' },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(forgedCard.status, 200);
    assert.deepEqual(
      Buffer.from(await forgedCard.arrayBuffer()),
      png,
      'Request fields must not change the configured sharing-image company',
    );
    const sharingImageFile = resolve(tmpdir(), 'realtor-seo-sharing-card.png');
    await writeFile(sharingImageFile, png);
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
          seo: {
            trustedCanonical: true,
            openGraph: true,
            twitterCard: true,
            previewNoindex: true,
            missingProperty: { status: missing.status, notFoundBoundary: true, noindex: true },
            robotsDisallowPreview: true,
            syntheticSitemapEmpty: true,
            sharingImageTenantOverrideIgnored: true,
            sharingPng: { width: 1200, height: 630, bytes: png.length, file: sharingImageFile },
          },
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
