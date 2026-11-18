/** Disposable synthetic enquiry UI. Tokens are server-only and never logged. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  assertEnquiryLaunchAvailable,
  enquiryLaunchConfiguration,
} from '../apps/api/dev/enquiry-launch-config.mjs';

const launch = enquiryLaunchConfiguration(process.env, process.argv.slice(2));
const pilot = launch.journeyFixture === 'web-admin-pilot-v1';
if (pilot && process.platform !== 'win32')
  throw Error('The current pilot photo processor requires Windows.');
if (
  [
    '--invalid-first-viewing-reply',
    '--invalid-first-confirmation-reply',
    '--invalid-first-termination-reply',
    '--invalid-first-reschedule-reply',
    '--invalid-first-outcome-reply',
  ].filter((flag) => process.argv.includes(flag)).length > 1
)
  throw new Error('Choose one synthetic viewing reply fault.');
const root = fileURLToPath(new URL('../', import.meta.url));
const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
let preview, child, webChild, input, closing;
async function stop() {
  return (closing ??= (async () => {
    try {
      input?.close();
      for (const running of [child, webChild])
        if (running && running.exitCode === null && running.signalCode === null) {
          const exited = new Promise((resolve) => running.once('exit', resolve));
          let timeout;
          try {
            running.kill();
            await Promise.race([
              exited,
              new Promise((resolve) => {
                timeout = setTimeout(resolve, 3000);
                timeout.unref();
              }),
            ]);
            if (running.exitCode === null && running.signalCode === null) running.kill('SIGKILL');
          } finally {
            clearTimeout(timeout);
          }
        }
    } finally {
      await preview?.close();
    }
  })());
}
try {
  await assertEnquiryLaunchAvailable(launch, root);
  const { startStaffPreview } = await import('../apps/api/dev/staff-preview.mjs');
  preview = await startStaffPreview({
    port: Number(launch.apiPort),
    tenantSlug: process.env.TENANT_SLUG ?? 'realtime-estates',
    enquiryPreview: 'synthetic-v1',
    ...(pilot
      ? {
          actor: 'admin',
          nativeUploads: {
            mode: 'synthetic-native-v1',
            rootDirectory: await mkdtemp(join(tmpdir(), 'realtor-pilot-browser-')),
            powerShellPath:
              process.env.REALTOR_TEST_POWERSHELL ??
              join(
                homedir(),
                '.cache',
                'codex-runtimes',
                'codex-primary-runtime',
                'dependencies',
                'native',
                'powershell',
                'pwsh.exe',
              ),
          },
        }
      : {}),
    ...(launch.journeyFixture ? { journeyFixture: launch.journeyFixture } : {}),
    ...(process.argv.includes('--reminder-capture')
      ? { reminderCaptureMode: 'capture-only-v1' }
      : {}),
    ...(process.argv.includes('--invalid-first-captured-reply')
      ? { reminderReplyFault: 'invalid-first-captured-v1' }
      : {}),
    ...(process.argv.includes('--historical-viewings')
      ? { historicalViewings: 'synthetic-v1' }
      : {}),
    ...(process.argv.includes('--invalid-first-outcome-reply')
      ? { viewingReplyFault: 'invalid-first-outcome-v1' }
      : {}),
    ...(process.argv.includes('--web') || launch.journeyFixture
      ? { enquiryCatalogue: 'synthetic-v1' }
      : {}),
    ...(process.argv.includes('--invalid-first-reschedule-reply')
      ? { viewingReplyFault: 'invalid-first-reschedule-v1' }
      : {}),
    ...(process.argv.includes('--invalid-first-termination-reply')
      ? { viewingReplyFault: 'invalid-first-termination-v1' }
      : {}),
    ...(process.argv.includes('--invalid-first-confirmation-reply')
      ? { viewingReplyFault: 'invalid-first-confirmation-v1' }
      : {}),
    ...(process.argv.includes('--invalid-first-viewing-reply')
      ? { viewingReplyFault: 'invalid-first-applied-v1' }
      : {}),
    ...(process.argv.includes('--invalid-first-contact-reply')
      ? { contactReplyFault: 'invalid-first-applied-v1' }
      : {}),
  });
  if (process.argv.includes('--historical-viewings'))
    console.log(
      'Fictional historical confirmed viewings enabled for outcome testing. No past HTTP execution or real attendance is implied. Requires --web.',
    );
  if (preview.journeyFixture)
    console.log(
      'Explicit enquiry journey fixture: 60 synthetic admin leads and 53 assigned-agent leads; no real prospects.',
    );
  const { admin, agent } = preview.enquiryStaff;
  const inherited = pilot
    ? Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^(?:STAFF_|WEB_|ALLOW_LOOPBACK_API$|API_ORIGIN$)/i.test(key),
        ),
      )
    : process.env;
  child = spawn(
    process.execPath,
    [next, 'dev', 'apps/admin', '-p', launch.uiPort, '-H', '127.0.0.1'],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...inherited,
        NODE_ENV: 'development',
        TENANT_SLUG: preview.tenantSlug,
        STAFF_PREVIEW_MODE: pilot ? 'synthetic' : '',
        STAFF_PREVIEW_TOKEN: pilot ? admin.bearerToken : '',
        STAFF_PREVIEW_INSTANCE: pilot ? randomUUID() : '',
        STAFF_PREVIEW_MEDIA: pilot ? 'synthetic' : '',
        STAFF_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
        STAFF_REMINDER_CAPTURE_MODE: process.argv.includes('--reminder-capture')
          ? 'capture-only-v1'
          : '',
        STAFF_PREVIEW_API_ORIGIN: preview.origin,
        STAFF_ENQUIRY_ADMIN_TOKEN: admin.bearerToken,
        STAFF_ENQUIRY_ADMIN_ID: admin.actorId,
        STAFF_ENQUIRY_ADMIN_INSTANCE: randomUUID(),
        STAFF_ENQUIRY_AGENT_TOKEN: agent.bearerToken,
        STAFF_ENQUIRY_AGENT_ID: agent.actorId,
        STAFF_ENQUIRY_AGENT_INSTANCE: randomUUID(),
      },
    },
  );
  child.once('error', () => {
    process.exitCode = 1;
    console.error('The synthetic enquiry UI could not start.');
    void stop();
  });
  child.once('exit', (code) => {
    if (!closing) process.exitCode = code ?? 1;
    void stop();
  });
  if (launch.webPort) {
    // No staff credentials are inherited by the public web process.
    const publicEnv = Object.fromEntries(
      Object.entries(inherited).filter(([key]) => !/^STAFF_/i.test(key)),
    );
    webChild = spawn(
      process.execPath,
      [next, 'dev', 'apps/web', '-p', launch.webPort, '-H', '127.0.0.1'],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...publicEnv,
          NODE_ENV: 'development',
          TENANT_SLUG: preview.tenantSlug,
          WEB_CATALOGUE_MODE: 'connected',
          WEB_CATALOGUE_DATA: 'synthetic',
          API_ORIGIN: preview.origin,
          ALLOW_LOOPBACK_API: 'true',
          ...(pilot
            ? {
                WEB_CATALOGUE_SEARCH: 'public-search-v1',
                WEB_PUBLIC_MEDIA_MODE: 'synthetic-native-v1',
              }
            : {}),
          WEB_ENQUIRY_PROPERTY_MODE: 'synthetic-v1',
          WEB_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
          WEB_ENQUIRY_API_ORIGIN: preview.origin,
          WEB_ENQUIRY_INSTANCE: randomUUID(),
        },
      },
    );
    webChild.once('error', () => {
      process.exitCode = 1;
      console.error('The public enquiry preview could not start.');
      void stop();
    });
    webChild.once('exit', (code) => {
      if (!closing) process.exitCode = code ?? 1;
      void stop();
    });
    console.log(`Synthetic public website enquiry: http://127.0.0.1:${launch.webPort}/enquire`);
  }
  if (pilot) {
    console.log(`Pilot listing creation: http://127.0.0.1:${launch.uiPort}/listings/new`);
    console.log(`Pilot moderation: http://127.0.0.1:${launch.uiPort}/reviews`);
    console.log(`Pilot public catalogue: http://127.0.0.1:${launch.webPort}/`);
    input = createInterface({ input: process.stdin });
    input.on('line', (line) => {
      if (line.trim() === 'quit') void stop();
    });
  }
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      process.exitCode = 0;
      void stop();
    });
  console.log(`Synthetic guest intake: http://127.0.0.1:${launch.uiPort}/enquiry-intake`);
  console.log(`Synthetic admin enquiries: http://127.0.0.1:${launch.uiPort}/enquiries/admin`);
  console.log(
    `Synthetic assigned-agent enquiries: http://127.0.0.1:${launch.uiPort}/enquiries/agent`,
  );
  console.log(
    'Shared disposable synthetic database; identity expires in 30 minutes. Changes disappear on stop.',
  );
  if (process.argv.includes('--invalid-first-reschedule-reply'))
    console.log(
      'Synthetic fault enabled: first applied reschedule returns an invalid receipt after commit; earlier saves and original recovery remain normal. Requires --web.',
    );
  if (process.argv.includes('--invalid-first-confirmation-reply'))
    console.log(
      'Synthetic fault enabled: first applied confirmation returns an invalid receipt after commit; requests/proposals and original reads/replay stay normal. Requires --web.',
    );
  if (process.argv.includes('--invalid-first-viewing-reply'))
    console.log(
      'Synthetic fault enabled: first applied viewing returns an invalid receipt after commit; original receipt read and exact replay remain available. Requires --web.',
    );
  if (process.argv.includes('--invalid-first-contact-reply'))
    console.log(
      'Synthetic fault enabled: first applied contact returns an invalid receipt after commit; original receipt read and exact replay remain available.',
    );
} catch {
  process.exitCode = 1;
  console.error('The synthetic enquiry preview could not start.');
  await stop();
}
