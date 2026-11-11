/** Disposable loopback fixture for the signed admin deletion triage journey. */
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CustomerFavouritesClient } from '@realtor/api-client';
import { startCustomerPreview } from '../apps/api/dev/customer-preview.mjs';

const args = process.argv.slice(2);
if (
  process.env.NODE_ENV !== 'development' ||
  args.some((arg) => arg !== '--lost-result') ||
  args.length > 1
)
  throw Error('Run in development with optional --lost-result.');
if (existsSync(new URL('../apps/admin/.next/dev/lock', import.meta.url)))
  throw Error('The admin development directory is occupied.');

const preview = await startCustomerPreview({
  pushMode: 'synthetic-customer-push-v1',
  deletionMode: 'synthetic-customer-deletion-v1',
  deletionReviewMode: 'synthetic-admin-deletion-review-v1',
  ...(args.includes('--lost-result')
    ? { deletionReviewReplyFault: 'lost-first-deletion-review-v1' }
    : {}),
});
const execute = promisify(execFile);
let child;
let shutdown;
let input;
function stop() {
  if (shutdown) return shutdown;
  shutdown = (async () => {
    input?.close();
    try {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          try {
            await execute('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
            });
          } catch (error) {
            if (child.exitCode === null && child.signalCode === null) {
              try {
                await once(child, 'exit', { signal: AbortSignal.timeout(5000) });
              } catch {
                throw error;
              }
            }
          }
        } else child.kill('SIGTERM');
        if (child.exitCode === null && child.signalCode === null)
          await once(child, 'exit', { signal: AbortSignal.timeout(5000) });
      }
    } finally {
      await preview.close();
    }
  })();
  return shutdown;
}
function fail(error) {
  console.error(error.message);
  process.exitCode = 1;
  void stop().catch((cleanup) => console.error(cleanup.message));
}
try {
  const port = '3139';
  const origin = 'http://127.0.0.1:' + port;
  const reviewer = await preview.deletionReviewStaff();
  for (const user of preview.configuration(origin).users) {
    const customer = new CustomerFavouritesClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      scope: { tenantId: preview.tenantId, customerId: user.id },
    });
    await customer.requestAccountDeletion(
      {
        policy: 'synthetic-customer-deletion-command-v1',
        requestId: randomUUID(),
        confirmed: true,
      },
      { bearerToken: user.bearerToken },
    );
  }
  child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
      'dev',
      'apps/admin',
      '-p',
      port,
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
      env: {
        ...process.env,
        TENANT_SLUG: preview.tenantSlug,
        STAFF_PREVIEW_MODE: 'synthetic',
        STAFF_PREVIEW_API_ORIGIN: preview.origin,
        STAFF_PREVIEW_TOKEN: reviewer.token,
        STAFF_PREVIEW_INSTANCE: randomUUID(),
        STAFF_DELETION_TRIAGE_MODE: 'synthetic-v1',
        STAFF_DELETION_TRIAGE_TENANT: preview.tenantId,
        STAFF_DELETION_TRIAGE_REVIEWER: reviewer.reviewerId,
      },
    },
  );
  child.once('error', fail);
  child.once('exit', (code) => {
    if (!shutdown) fail(Error('Admin preview stopped with exit code ' + code));
  });
  input = createInterface({ input: process.stdin, terminal: false });
  let commands = Promise.resolve();
  input.on('line', (line) => {
    commands = commands
      .then(async () => {
        if (line === 'quit') await stop();
        if (line === 'revoke') {
          await reviewer.revoke();
          console.log('Synthetic reviewer access revoked.');
        }
      })
      .catch(fail);
  });
  input.once('close', () => {
    if (!shutdown) void commands.then(stop).catch(fail);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop().catch(fail));
  console.log('Synthetic deletion triage ' + origin + '/deletion-triage. Use revoke or quit.');
} catch (error) {
  fail(error);
}
