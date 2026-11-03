/** Owned loopback demonstration. Uses one UI child at a time; no live/provider access. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareSecondBrandDemo } from './second-brand-fixture.mjs';
import { retireOwnedStaffChild } from './staff-preview-lifecycle.mjs';
const slug = process.argv[2];
if (process.env.NODE_ENV !== 'development' || process.argv.length !== 3)
  throw Error('Explicit development and one synthetic brand required.');
if (existsSync(new URL('../apps/web/.next/dev/lock', import.meta.url)))
  throw Error('Web development checkout is occupied.');
const nextEnv = new URL('../apps/web/next-env.d.ts', import.meta.url),
  originalNextEnv = readFileSync(nextEnv);
const demo = await prepareSecondBrandDemo(slug);
let child, closing;
const input = createInterface({ input: process.stdin, terminal: false });
const stop = () =>
  (closing ??= (async () => {
    input.close();
    try {
      if (child) await retireOwnedStaffChild(child);
    } finally {
      await demo.preview.close();
      writeFileSync(nextEnv, originalNextEnv);
    }
  })());
const env = {
  ...process.env,
  NODE_ENV: 'development',
  NODE_OPTIONS: '--max-old-space-size=640',
  TENANT_SLUG: slug,
  TENANT_MANIFEST_JSON: JSON.stringify(demo.manifest),
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_DATA: 'synthetic',
  WEB_CATALOGUE_SEARCH: 'public-search-v1',
  API_ORIGIN: demo.preview.origin,
  ALLOW_LOOPBACK_API: 'true',
};
for (const key of [
  'WEB_COMPANY_SETTINGS_MODE',
  'WEB_COMPANY_SETTINGS_ORIGIN',
  'WEB_CATALOGUE_REFERENCE',
  'WEB_CATALOGUE_VIDEO',
])
  delete env[key];
try {
  child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
      'dev',
      '--webpack',
      '-p',
      '3136',
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(new URL('../apps/web', import.meta.url)),
      windowsHide: true,
      stdio: 'inherit',
      env,
    },
  );
  console.log(
    JSON.stringify({
      brandProof: demo.proof,
      url: 'http://127.0.0.1:3136',
      detail: `http://127.0.0.1:3136/properties/${demo.preview.listingId}`,
    }),
  );
  input.on('line', (line) => {
    if (line.trim() === 'quit') void stop();
  });
  input.on('close', () => {
    if (!closing) void stop();
  });
  child.once('error', () => {
    process.exitCode = 1;
    void stop();
  });
  child.once('exit', (code) => {
    if (!closing) {
      process.exitCode = code ?? 1;
      void stop();
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
} catch (e) {
  await stop();
  throw e;
}
