import { syntheticRecoveryEnvironment } from './synthetic-recovery-env.mjs';
/** Local synthetic operations UI; credentials are server-only and never logged. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
const recoveryEnvironment = syntheticRecoveryEnvironment();
if (process.env.NODE_ENV === 'production') throw Error('Operations preview refuses production.');
const args = process.argv.slice(2);
if (
  new Set(args).size !== args.length ||
  args.some((arg) => !['--reviews', '--reminders', '--lost-reminder-result'].includes(arg))
)
  throw Error('Use --reviews, or optional --reminders and --lost-reminder-result for enquiry QA.');
const reviews = args.includes('--reviews');
const reminders = args.includes('--reminders'),
  lostReminder = args.includes('--lost-reminder-result');
if ((reviews && (reminders || lostReminder)) || (lostReminder && !reminders))
  throw Error('Reminder QA requires enquiry mode and explicit --reminders.');
const port = process.env.OPERATIONS_UI_PORT ?? '3116';
if (!/^[1-9]\d{3,4}$/.test(port) || Number(port) > 65535)
  throw Error('Invalid operations UI port.');
if (existsSync(new URL('../apps/admin/.next/dev/lock', import.meta.url)))
  throw Error('Admin development directory is occupied.');
const preview = await startStaffPreview({
  port: 0,
  tenantSlug: process.env.TENANT_SLUG ?? 'realtime-estates',
  actor: 'admin',
  ...(reviews
    ? { seedPendingReviews: true }
    : {
        enquiryPreview: 'synthetic-v1',
        enquiryCatalogue: 'synthetic-v1',
        historicalViewings: 'synthetic-v1',
        ...(reminders ? { reminderCaptureMode: 'capture-only-v1' } : {}),
        ...(lostReminder ? { reminderReplyFault: 'invalid-first-captured-v1' } : {}),
      }),
});
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(
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
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ...recoveryEnvironment,
      TENANT_SLUG: preview.tenantSlug,
      STAFF_PREVIEW_MODE: reviews ? 'synthetic' : '',
      STAFF_PREVIEW_TOKEN: reviews ? preview.bearerToken : '',
      STAFF_PREVIEW_INSTANCE: randomUUID(),
      STAFF_PREVIEW_API_ORIGIN: preview.origin,
      STAFF_PREVIEW_MEDIA: '',
      STAFF_REMINDER_CAPTURE_MODE: reminders ? 'capture-only-v1' : '',
      STAFF_ENQUIRY_PREVIEW_MODE: reviews ? '' : 'synthetic-v1',
      STAFF_ENQUIRY_ADMIN_TOKEN: preview.enquiryStaff?.admin.bearerToken ?? '',
      STAFF_ENQUIRY_ADMIN_ID: preview.enquiryStaff?.admin.actorId ?? '',
      STAFF_ENQUIRY_ADMIN_INSTANCE: randomUUID(),
      STAFF_ENQUIRY_AGENT_TOKEN: preview.enquiryStaff?.agent.bearerToken ?? '',
      STAFF_ENQUIRY_AGENT_ID: preview.enquiryStaff?.agent.actorId ?? '',
      STAFF_ENQUIRY_AGENT_INSTANCE: randomUUID(),
    },
  },
);
console.log(
  `Synthetic operations overview (${reviews ? 'reviews' : 'enquiries and outcomes'}): http://127.0.0.1:${port}/operations`,
);
if (!reviews) console.log(`Synthetic viewing calendar: http://127.0.0.1:${port}/viewings/admin`);
if (reminders)
  console.log(
    `Reminder QA captures test records only; no outbound provider. First captured reply fault: ${lostReminder}.`,
  );
console.log(
  'Disposable synthetic data; no messages, production identity, provider or live-system changes.',
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
  await preview.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
child.once('error', () => {
  process.exitCode = 1;
  void stop();
});
child.once('exit', (code) => {
  process.exitCode = code ?? 0;
  void stop();
});
