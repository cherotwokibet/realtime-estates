/** Disposable local-only settings journey. Ephemeral signed identity stays in child server environment. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
const args = process.argv.slice(2);
if (
  process.env.NODE_ENV === 'production' ||
  new Set(args).size !== args.length ||
  args.some((x) => !['--lost-result', '--second-brand'].includes(x))
)
  throw Error('Development only: optional --lost-result and --second-brand.');
for (const app of ['admin', 'web'])
  if (existsSync(new URL('../apps/' + app + '/.next/dev/lock', import.meta.url)))
    throw Error(app + ' development directory occupied.');
const preview = await startStaffPreview({
  port: 0,
  actor: 'admin',
  tenantSlug: args.includes('--second-brand') ? 'sample-homes' : 'realtime-estates',
  seedAcceptedMedia: false,
  ...(args.includes('--lost-result') ? { settingsReplyFault: 'invalid-first-approved-v1' } : {}),
});
const children = [];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  await preview.close();
}
for (const [app, port] of [
  ['admin', '3120'],
  ['web', '3121'],
]) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
      'dev',
      'apps/' + app,
      '-p',
      port,
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TENANT_SLUG: preview.tenantSlug,
        ...(app === 'admin'
          ? {
              STAFF_PREVIEW_MODE: 'synthetic',
              STAFF_PREVIEW_TOKEN: preview.bearerToken,
              STAFF_PREVIEW_INSTANCE: randomUUID(),
              STAFF_PREVIEW_API_ORIGIN: preview.origin,
            }
          : {
              WEB_COMPANY_SETTINGS_MODE: 'synthetic-v1',
              WEB_COMPANY_SETTINGS_ORIGIN: preview.origin,
            }),
      },
    },
  );
  children.push(child);
  child.once('error', () => {
    process.exitCode = 1;
    void stop();
  });
  child.once('exit', () => void stop());
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
console.log(
  'Synthetic settings editor http://127.0.0.1:3120/settings; public company http://127.0.0.1:3121/company. Disposable data, no messages/provider or live-system changes. First approved reply corrupt: ' +
    args.includes('--lost-result'),
);
