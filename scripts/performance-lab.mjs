/** Owned loopback only. Finite synthetic workload; never a public load generator. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, freemem, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
import { publicLoadStock } from '../apps/api/dev/journey-fixtures.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, output, ...extra] = process.argv.slice(2);
if (
  !['api', 'web'].includes(mode) ||
  !output ||
  extra.length ||
  process.env.NODE_ENV === 'production'
)
  throw Error(
    'Use api|web and a new relative docs/evidence/...json output in a development shell.',
  );
const destination = resolve(root, output),
  rel = relative(root, destination).replaceAll('\\', '/');
if (isAbsolute(rel) || !/^docs\/evidence\/[a-zA-Z0-9_./-]+\.json$/.test(rel) || rel.includes('..'))
  throw Error('Choose an evidence JSON path inside this checkout.');
try {
  await access(destination);
  throw Error('Refusing to overwrite an existing measurement.');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const budgetBytes = await readFile(new URL('performance-budget.json', import.meta.url));
const budget = JSON.parse(budgetBytes);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const implementationFiles = [
  'scripts/performance-lab.mjs',
  'scripts/performance-budget.json',
  'apps/api/dev/journey-fixtures.mjs',
  'apps/api/dev/staff-preview.mjs',
];
const report = {
  policy: budget.policy,
  mode,
  startedAt: new Date().toISOString(),
  status: 'running',
  complete: false,
  source: {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    implementation: Object.fromEntries(
      await Promise.all(
        implementationFiles.map(async (f) => [f, sha(await readFile(resolve(root, f)))]),
      ),
    ),
  },
  budgetSha256: sha(budgetBytes),
  budget,
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
  },
  samples: [],
  probes: [],
  violations: [],
  cleanup: 'pending',
  limits: budget.limits,
};
await mkdir(resolve(destination, '..'), { recursive: true });
const save = () => writeFile(destination, JSON.stringify(report, null, 2) + '\n');
await save();
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
function summary(samples) {
  const times = samples.map((s) => s.ms);
  return {
    requests: samples.length,
    p50Ms: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    p99Ms: percentile(times, 0.99),
    maxMs: Math.max(...times),
    maxBodyBytes: Math.max(...samples.map((s) => s.bytes)),
  };
}
let preview, child;
async function measure(url, name, expectedStatus = 200, target = report.samples) {
  const start = performance.now();
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(budget.load.timeoutMs),
    });
    const headersMs = performance.now() - start;
    const bytes = Buffer.from(await response.arrayBuffer());
    const sample = {
      name,
      status: response.status,
      headersMs,
      ms: performance.now() - start,
      bytes: bytes.length,
    };
    target.push(sample);
    assert.equal(response.status, expectedStatus, name + ' status');
    return { sample, bytes };
  } catch (e) {
    if (!target.some((s) => s.name === name))
      target.push({ name, status: 'network-failure', ms: performance.now() - start, bytes: 0 });
    throw e;
  }
}
async function api() {
  console.log(
    'Seeding exactly1000 approved synthetic listings through guarded routines; no external service.',
  );
  const seedStart = performance.now();
  preview = await startStaffPreview({
    port: 0,
    actor: 'admin',
    journeyFixture: 'public-load-v1',
    referenceDraftMode: 'synthetic-reference-draft-v1',
    referenceModerationMode: 'synthetic-reference-transition-v1',
    referencePublicMode: 'synthetic-reference-public-v1',
  });
  report.seed = { ms: performance.now() - seedStart, ...preview.journeyFixture.lab };
  const base = preview.origin + '/v3/properties/search?';
  const own = publicLoadStock('realtime-estates'),
    foreign = publicLoadStock('sample-homes');
  const allowed = new Set([preview.referencePublicListingId, ...own.manifest.listingIds]);
  function verify(bytes, expected, limit, offset = 0) {
    const text = bytes.toString('utf8'),
      body = JSON.parse(text);
    assert.equal(body.policy, 'synthetic-reference-search-v1');
    assert.equal(body.total, expected);
    assert.equal(body.offset, offset);
    assert.equal(body.limit, limit);
    assert.equal(body.items.length, Math.min(limit, Math.max(0, expected - offset)));
    assert.equal(body.hasMore, offset + body.items.length < expected);
    assert.equal(new Set(body.items.map((r) => r.id)).size, body.items.length);
    assert.ok(
      body.items.every((r) => allowed.has(r.id)),
      'Foreign inventory leaked',
    );
    assert.ok(!text.includes(preview.bearerToken));
    assert.ok(!text.includes('PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS'));
    assert.ok(!text.includes('synthetic-load-sample-homes'));
    assert.ok(bytes.length <= budget.api.maxBodyBytes);
    return body;
  }
  const cold = await measure(base + 'limit=12', 'cold-default', 200, report.probes);
  verify(cold.bytes, 500, 12);
  report.cold = cold.sample;
  const cases = [
    { name: 'first12', q: 'limit=12', total: 500, limit: 12 },
    { name: 'late12', q: 'limit=12&offset=480', total: 500, limit: 12, offset: 480 },
    { name: 'bounded100', q: 'limit=100', total: 500, limit: 100 },
    {
      name: 'monthly-price',
      q: 'purpose=rent&period=month&sort=price_low&limit=12',
      total: own.manifest.monthlyGenerated + 1,
      limit: 12,
    },
    {
      name: 'sale-price',
      q: 'purpose=sale&sort=price_high&limit=12',
      total: own.manifest.saleGenerated,
      limit: 12,
    },
    {
      name: 'eight-plus',
      q: 'beds=8&bedsMode=at_least&limit=12',
      total: own.rows.filter((r) => r.bedrooms >= 8).length,
      limit: 12,
    },
    {
      name: 'county-amenity',
      q: 'countyId=00000000-0000-4000-8000-000000031001&amenityId=00000000-0000-4000-8000-000000031010&limit=12',
      total: 500,
      limit: 12,
    },
    { name: 'empty', q: 'location=not-a-synthetic-location&limit=12', total: 0, limit: 12 },
  ];
  for (const c of cases) {
    const result = await measure(base + c.q, 'warmup-' + c.name, 200, report.probes);
    verify(result.bytes, c.total, c.limit, c.offset);
  }
  console.log(
    'Seed and correctness warmups complete. Measuring48 requests with4 concurrent clients.',
  );
  report.requestMix = cases;
  await save();
  const started = performance.now();
  await Promise.all(
    Array.from({ length: budget.load.concurrency }, async (_, worker) => {
      for (let i = 0; i < budget.load.rounds; i++) {
        const c = cases[(worker + i) % cases.length];
        const result = await measure(base + c.q, `${worker}-${i}-${c.name}`);
        const body = verify(result.bytes, c.total, c.limit, c.offset);
        if (c.name === 'monthly-price')
          assert.ok(
            body.items.every((r, j, a) => j === 0 || a[j - 1].amountMinor <= r.amountMinor),
          );
        if (c.name === 'sale-price')
          assert.ok(
            body.items.every((r, j, a) => j === 0 || a[j - 1].amountMinor >= r.amountMinor),
          );
      }
    }),
  );
  report.finiteBurstDurationMs = performance.now() - started;
  report.summary = summary(report.samples);
  for (const [metric, limit] of [
    ['p95Ms', budget.api.p95Ms],
    ['p99Ms', budget.api.p99Ms],
    ['maxMs', budget.api.maxMs],
  ])
    if (report.summary[metric] > limit)
      report.violations.push(`${metric} ${report.summary[metric]} exceeds ${limit}`);
  // Anonymous foreign-ID lookup must disclose nothing; body/authority/query bounds stay enforced.
  verify(
    (
      await measure(
        base + 'limit=1&id=' + foreign.rows[0].listingId,
        'foreign-id',
        200,
        report.probes,
      )
    ).bytes,
    0,
    1,
  );
  for (const q of ['limit=101', 'limit=12&tenantId=00000000-0000-4000-8000-000000000002'])
    await measure(base + q, 'reject-' + q, 400, report.probes);
  report.rateLimiter =
    'Unchanged;60 total reads including probes, below240/minute. No bypass/retry.';
}
async function web() {
  // This server has no provider configuration, credentials or connected API.
  await readFile(resolve(root, 'apps/web/.next/BUILD_ID'));
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    WEB_CATALOGUE_MODE: 'demo',
    WEB_CATALOGUE_DATA: 'synthetic',
    TENANT_SLUG: 'realtime-estates',
  };
  for (const key of Object.keys(env))
    if (
      /^(STAFF_PREVIEW_|WEB_ENQUIRY_|WEB_CATALOGUE_REFERENCE$|WEB_CATALOGUE_SEARCH$|ALLOW_LOOPBACK_API$|API_ORIGIN$)/.test(
        key,
      )
    )
      delete env[key];
  child = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/next/dist/bin/next'),
      'start',
      'apps/web',
      '-p',
      '3130',
      '-H',
      '127.0.0.1',
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let startup = '';
  child.stdout.on('data', (b) => {
    startup = (startup + b).slice(-4000);
  });
  child.stderr.on('data', (b) => {
    startup = (startup + b).slice(-4000);
  });
  await new Promise((done, fail) => {
    const timer = setTimeout(() => {
      clearInterval(poll);
      fail(Error('Owned production preview readiness deadline'));
    }, 20000);
    const poll = setInterval(() => {
      if (startup.includes('Ready')) {
        clearInterval(poll);
        clearTimeout(timer);
        done();
      } else if (child.exitCode !== null) {
        clearInterval(poll);
        clearTimeout(timer);
        fail(Error('Owned production preview exited: ' + startup));
      }
    }, 100);
  });
  report.productionDemoBuildId = (
    await readFile(resolve(root, 'apps/web/.next/BUILD_ID'), 'utf8')
  ).trim();
  report.routes = [];
  for (const path of ['/', '/properties/demo-ruaka-1', '/company', '/contact', '/enquiry']) {
    const probes = [],
      samples = [],
      cold = await measure('http://127.0.0.1:3130' + path, 'cold' + path, 200, probes);
    const html = cold.bytes.toString('utf8');
    const chunks = [
      ...new Set([...html.matchAll(/<script\b[^>]*src="([^"#]+)"/g)].map((m) => m[1])),
    ];
    let gzipBytes = 0;
    for (const chunk of chunks) {
      assert.ok(chunk.startsWith('/_next/static/') && !chunk.includes('..'));
      const asset = await measure(new URL(chunk, 'http://127.0.0.1:3130'), chunk, 200, probes);
      gzipBytes += gzipSync(asset.bytes).length;
    }
    for (let i = 0; i < budget.web.warmRequestsPerRoute; i++)
      await measure('http://127.0.0.1:3130' + path, `warm${i}${path}`, 200, samples);
    const result = {
      path,
      cold: cold.sample,
      summary: summary(samples),
      p95TtfbMs: percentile(
        samples.map((s) => s.headersMs),
        0.95,
      ),
      initialJsGzipBytes: gzipBytes,
      initialChunks: chunks.length,
    };
    report.routes.push(result);
    report.samples.push(...samples);
    report.probes.push(...probes);
    if (result.p95TtfbMs > budget.web.p95TtfbMs)
      report.violations.push(path + ' TTFB exceeds budget');
    if (Math.max(cold.sample.bytes, result.summary.maxBodyBytes) > budget.web.maxHtmlBytes)
      report.violations.push(path + ' HTML exceeds budget');
    if (gzipBytes > budget.web.maxInitialJsGzipBytes)
      report.violations.push(path + ' initialJS exceeds budget');
    await save();
  }
}
try {
  await (mode === 'api' ? api() : web());
  report.status = report.violations.length ? 'budget-failed' : 'passed';
  report.complete = true;
} catch (e) {
  report.status = 'failed';
  report.error = { name: e.name, message: e.message };
  process.exitCode = 1;
} finally {
  try {
    if (preview) await preview.close();
    if (child && child.exitCode === null) {
      const exit = new Promise((resolve) => child.once('exit', resolve));
      if (process.platform === 'win32')
        await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
        });
      else child.kill('SIGTERM');
      await exit;
    }
    report.cleanup = 'Owned servers/database closed';
  } catch (e) {
    report.cleanup = 'Failed: ' + e.message;
    report.status = 'failed';
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await save();
}
if (report.status !== 'passed') process.exitCode = 1;
console.log(
  JSON.stringify({
    output: rel,
    status: report.status,
    complete: report.complete,
    summary: report.summary,
    routes: report.routes,
    violations: report.violations,
    error: report.error,
    cleanup: report.cleanup,
  }),
);
