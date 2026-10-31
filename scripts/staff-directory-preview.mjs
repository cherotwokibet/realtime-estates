/** Owned disposable signed staff UI. Never production or a vendor/live-system adapter. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
const args = process.argv.slice(2),
  allowed = ['--lost-results', '--agent', '--foreign-admin', '--second-brand'];
if (
  process.env.NODE_ENV === 'production' ||
  new Set(args).size !== args.length ||
  args.some((x) => !allowed.includes(x)) ||
  (args.includes('--agent') && args.includes('--foreign-admin'))
)
  throw Error('Development staff preview options are invalid.');
if (existsSync(new URL('../apps/admin/.next/dev/lock', import.meta.url)))
  throw Error('Existing admin development directory occupied; preserve it.');
const api = await startStaffPreview({
  port: 0,
  actor: args.includes('--agent')
    ? 'agent'
    : args.includes('--foreign-admin')
      ? 'other-company-admin'
      : 'admin',
  tenantSlug: args.includes('--second-brand') ? 'sample-homes' : 'realtime-estates',
  seedAcceptedMedia: false,
  staffInvitationMode: 'synthetic-capture-only-v1',
  ...(args.includes('--lost-results')
    ? {
        branchReplyFault: 'invalid-first-branch-result-v1',
        invitationReplyFault: 'invalid-first-invitation-results-v1',
      }
    : {}),
});
const execute = promisify(execFile),
  input = createInterface({ input: process.stdin, terminal: false });
let child = null,
  stopping = false,
  queue = Promise.resolve();
async function retire(owned) {
  if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
  if (process.platform === 'win32')
    await execute('taskkill', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true });
  else owned.kill('SIGTERM');
}
async function stop() {
  if (stopping) return;
  stopping = true;
  input.close();
  const owned = child;
  child = null;
  await retire(owned);
  await api.close();
}
async function launch() {
  if (stopping) return;
  const old = child;
  child = null;
  await retire(old);
  child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
      'dev',
      'apps/admin',
      '-p',
      '3124',
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
        TENANT_SLUG: api.tenantSlug,
        STAFF_PREVIEW_MODE: 'synthetic',
        STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
        STAFF_PREVIEW_API_ORIGIN: api.origin,
        STAFF_PREVIEW_TOKEN: api.bearerToken,
        STAFF_PREVIEW_INSTANCE: randomUUID(),
      },
    },
  );
  const owned = child;
  owned.once('error', () => {
    process.exitCode = 1;
    void stop();
  });
  owned.once('exit', (code) => {
    if (!stopping && child === owned) {
      process.exitCode = code ?? 1;
      void stop();
    }
  });
  console.log(
    'Owned staff admin UI pid ' +
      owned.pid +
      ' at http://127.0.0.1:3124/staff. Signed identity stays in child environment.',
  );
}
input.on('line', (line) => {
  queue = queue
    .then(() =>
      line.trim() === 'quit'
        ? stop()
        : line.trim() === 'restart'
          ? launch()
          : console.log('Use restart or quit.'),
    )
    .catch(() => {
      process.exitCode = 1;
      void stop();
    });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
await launch();
console.log(
  'Synthetic staff requests only: no email, secret/redemption or membership grant. --lost-results corrupts first committed branch/capture/revocation replies. Restart retains owned API/database with a fresh browser instance; quit stops only owned children and fixtures.',
);
