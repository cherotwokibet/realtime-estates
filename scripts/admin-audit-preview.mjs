import { syntheticRecoveryEnvironment } from './synthetic-recovery-env.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startAdminAuditPreview } from '../apps/api/dev/admin-audit-preview.mjs';
const recoveryEnvironment = syntheticRecoveryEnvironment();
if (process.env.NODE_ENV === 'production' || process.argv.length > 2)
  throw Error('Audit preview is development-only; use TENANT_SLUG to select a synthetic company.');
const root = fileURLToPath(new URL('../', import.meta.url)),
  port = 3138;
const lock = new URL('../apps/admin/.next/dev/lock', import.meta.url);
if (existsSync(lock)) throw Error('Admin development directory is occupied.');
const envFile = new URL('../apps/admin/next-env.d.ts', import.meta.url),
  envBytes = readFileSync(envFile);
const fixture = await startAdminAuditPreview({
  mode: 'synthetic-admin-audit-v1',
  company: process.env.TENANT_SLUG ?? 'realtime-estates',
});
const child = spawn(
  process.execPath,
  [
    '--max-old-space-size=512',
    fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    'dev',
    'apps/admin',
    '--webpack',
    '-p',
    String(port),
    '-H',
    '127.0.0.1',
  ],
  {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ...recoveryEnvironment,
      TENANT_SLUG: fixture.company,
      STAFF_PREVIEW_MODE: 'synthetic',
      STAFF_PREVIEW_TOKEN: fixture.token(),
      STAFF_PREVIEW_API_ORIGIN: fixture.origin,
      STAFF_PREVIEW_INSTANCE: randomUUID(),
      STAFF_AUDIT_PREVIEW_MODE: 'synthetic-admin-audit-v1',
      STAFF_AUDIT_WEB_ORIGIN: 'http://127.0.0.1:' + port,
    },
  },
);
let stopping;
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      await ended;
    }
    await fixture.close();
    writeFileSync(envFile, envBytes);
  })();
  return stopping;
}
const lines = createInterface({ input: process.stdin });
lines.on('line', async (line) => {
  try {
    if (line === 'quit') {
      await stop();
      process.exitCode = 0;
    } else if (line === 'revoke' || line === 'restore') {
      await fixture.access(line === 'restore');
      console.log('Synthetic audit access ' + (line === 'restore' ? 'restored' : 'revoked') + '.');
    }
  } catch {
    console.error('Synthetic fixture control failed.');
  }
});
child.on('exit', () => {
  void stop();
});
child.on('error', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
console.log('Synthetic audit view: http://127.0.0.1:' + port + '/audit');
console.log('Developer controls: revoke / restore / quit. No HTTP administration endpoint.');
