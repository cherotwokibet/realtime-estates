/** Disposable local-only settings journey. Ephemeral signed identity stays in child server environment. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
const args = process.argv.slice(2);
if (
  process.env.NODE_ENV === 'production' ||
  new Set(args).size !== args.length ||
  args.some(
    (x) => !['--lost-result', '--second-brand', '--reports', '--report-lost-results'].includes(x),
  )
)
  throw Error('Development only: optional --lost-result and --second-brand.');
if (args.includes('--report-lost-results') && !args.includes('--reports'))
  throw Error('--report-lost-results requires --reports.');
for (const app of ['admin', 'web'])
  if (existsSync(new URL('../apps/' + app + '/.next/dev/lock', import.meta.url)))
    throw Error(app + ' development directory occupied.');
const preview = await startStaffPreview({
  port: 0,
  actor: 'admin',
  tenantSlug: args.includes('--second-brand') ? 'sample-homes' : 'realtime-estates',
  seedAcceptedMedia: args.includes('--reports'),
  ...(args.includes('--reports')
    ? {
        publicReportMode: 'synthetic-listing-report-v1',
        ...(args.includes('--report-lost-results')
          ? { reportReplyFault: 'invalid-first-report-results-v1' }
          : {}),
        referenceDraftMode: 'synthetic-reference-draft-v1',
        referenceModerationMode: 'synthetic-reference-transition-v1',
        referencePublicMode: 'synthetic-reference-public-v1',
      }
    : {}),
  ...(args.includes('--lost-result') ? { settingsReplyFault: 'invalid-first-approved-v1' } : {}),
});
const execute = promisify(execFile);
const input = createInterface({ input: process.stdin, terminal: false });
let activeChild = null,
  activeApp = null,
  stopping = false,
  queue = Promise.resolve();
async function retire(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // Only the exact child process created below and its descendants are disposable.
  if (process.platform === 'win32')
    await execute('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Owned UI retirement not confirmed.')), 10_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
}
async function stop() {
  if (stopping) return;
  stopping = true;
  input.close();
  const child = activeChild;
  activeChild = null;
  activeApp = null;
  await retire(child);
  await preview.close();
}
async function activate(app) {
  if (stopping || activeApp === app) return;
  const old = activeChild;
  activeChild = null;
  activeApp = null;
  await retire(old);
  const port = app === 'admin' ? '3120' : '3121';
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
      windowsHide: true,
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
              ...(args.includes('--reports') ? { STAFF_REPORT_PREVIEW_MODE: 'synthetic-v1' } : {}),
            }
          : {
              ...(args.includes('--reports')
                ? {
                    WEB_REPORT_PREVIEW_MODE: 'synthetic-v1',
                    WEB_REPORT_API_ORIGIN: preview.origin,
                    WEB_REPORT_INSTANCE: randomUUID(),
                    WEB_CATALOGUE_MODE: 'connected',
                    WEB_CATALOGUE_DATA: 'synthetic',
                    WEB_CATALOGUE_REFERENCE: 'synthetic-reference-public-v1',
                    API_ORIGIN: preview.origin,
                    ALLOW_LOOPBACK_API: 'true',
                  }
                : {
                    WEB_COMPANY_SETTINGS_MODE: 'synthetic-v1',
                    WEB_COMPANY_SETTINGS_ORIGIN: preview.origin,
                  }),
            }),
      },
    },
  );
  activeChild = child;
  activeApp = app;
  child.once('error', () => {
    process.exitCode = 1;
    void stop();
  });
  child.once('exit', (code) => {
    if (!stopping && activeChild === child) {
      process.exitCode = code ?? 1;
      void stop();
    }
  });
  console.log(
    'Owned ' +
      app +
      ' UI pid ' +
      child.pid +
      ' at http://127.0.0.1:' +
      port +
      '. Same synthetic API/database retained.',
  );
}
input.on('line', (line) => {
  const command = line.trim();
  queue = queue
    .then(() =>
      command === 'public'
        ? activate('web')
        : command === 'admin'
          ? activate('admin')
          : command === 'quit'
            ? stop()
            : console.log('Use public, admin or quit.'),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
      void stop();
    });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
await activate('admin');
if (args.includes('--reports'))
  console.log(
    'Reports: http://127.0.0.1:3120/reports . Type public then open http://127.0.0.1:3121/properties/' +
      preview.referencePublicListingId +
      '. Type admin to return to the same stored reports. No actual media bytes/provider/messages.',
  );
console.log(
  'Synthetic settings editor http://127.0.0.1:3120/settings. Type public to switch the same saved database to http://127.0.0.1:3121/company; admin to return; quit to stop. One UI runs at a time. Disposable data, no messages/provider or live-system changes. First approved reply corrupt: ' +
    args.includes('--lost-result'),
);
