/** Disposable loopback public read only. No account, credential file or provider purchase. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
import {
  referencePublicLaunchConfiguration,
  referencePublicWebEnvironment,
} from '../apps/api/dev/reference-public-launch-config.mjs';
const config = referencePublicLaunchConfiguration(process.env);
if (existsSync(new URL('../apps/web/.next/dev/lock', import.meta.url)))
  throw Error('Use a separate checkout; this public web development directory is occupied.');
const preview = await startStaffPreview({
  port: 0,
  tenantSlug: config.tenantSlug,
  actor: 'admin',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referencePublicMode: 'synthetic-reference-public-v1',
  ...(config.journeyFixture ? { journeyFixture: config.journeyFixture } : {}),
});
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    'dev',
    'apps/web',
    '-p',
    config.port,
    '-H',
    '127.0.0.1',
  ],
  {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
    env: referencePublicWebEnvironment(process.env, preview),
  },
);
console.log(`Synthetic public reference website: http://127.0.0.1:${config.port}`);
console.log(
  `Synthetic approved reference details: http://127.0.0.1:${config.port}/properties/${preview.referencePublicListingId}`,
);
console.log(
  'Disposable synthetic listings and metadata only; no real image-byte or production acceptance proof.',
);
if (preview.journeyFixture)
  console.log(
    'Explicit public journey fixture: 32 synthetic approved listings; no real stock or image bytes.',
  );
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
  await preview.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop());
child.on('error', () => {
  console.error('The public reference website could not start.');
  void stop();
  process.exitCode = 1;
});
child.on('exit', (code) => {
  void stop();
  process.exitCode = code ?? 0;
});
