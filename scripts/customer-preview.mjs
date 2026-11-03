import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCustomerPreview } from '../apps/api/dev/customer-preview.mjs';
import { retireOwnedStaffChild } from './staff-preview-lifecycle.mjs';
if (
  process.env.NODE_ENV !== 'development' ||
  !['realtime-estates', 'sample-homes'].includes(process.argv[2]) ||
  process.argv.length > 4 ||
  (process.argv[3] !== undefined && process.argv[3] !== '--lost-reply')
)
  throw Error('Choose an explicit synthetic development brand and optional --lost-reply.');
if (existsSync(new URL('../apps/web/.next/dev/lock', import.meta.url)))
  throw Error('Web development checkout is occupied.');
const nextEnv = new URL('../apps/web/next-env.d.ts', import.meta.url),
  originalNextEnv = readFileSync(nextEnv),
  slug = process.argv[2];
const preview = await startCustomerPreview({
  tenantSlug: slug,
  ...(process.argv[3] ? { replyFault: 'lost-first-favourite-result-v1' } : {}),
});
const input = createInterface({ input: process.stdin, terminal: false });
let child, closing;
const stop = () =>
  (closing ??= (async () => {
    input.close();
    try {
      if (child) await retireOwnedStaffChild(child);
    } finally {
      await preview.close();
      writeFileSync(nextEnv, originalNextEnv);
    }
  })());
const env = {
  ...process.env,
  NODE_ENV: 'development',
  NODE_OPTIONS: '--max-old-space-size=512',
  TENANT_SLUG: slug,
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_DATA: 'synthetic',
  WEB_CATALOGUE_SEARCH: 'public-search-v1',
  API_ORIGIN: preview.origin,
  ALLOW_LOOPBACK_API: 'true',
  WEB_CUSTOMER_PREVIEW_CONFIG: JSON.stringify(preview.configuration('http://127.0.0.1:3137')),
};
for (const key of [
  'TENANT_MANIFEST_JSON',
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
      '3137',
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(new URL('../apps/web', import.meta.url)),
      env,
      windowsHide: true,
      stdio: 'inherit',
    },
  );
  console.log(
    JSON.stringify({
      url:
        'http://127.0.0.1:3137/account' +
        (preview.listingId ? '?property=' + preview.listingId : ''),
      brand: slug,
      replyFault: process.argv[3] ? 'explicit one-shot lost committed reply' : 'off',
      expiresAt: preview.expiresAt,
      controls: 'pause/resume/revoke/quit affect this owned synthetic fixture only',
    }),
  );
  input.on('line', (line) => {
    if (line === 'quit') void stop();
    else if (['pause', 'resume', 'revoke'].includes(line))
      void preview[line]().then(() => console.log('Synthetic fixture ' + line + ' applied.'));
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
