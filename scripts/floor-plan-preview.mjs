/** Synthetic local launcher only. Credentials stay in child environment, never stdout or HTTP. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
if (process.env.NODE_ENV === 'production' || process.argv.length > 2)
  throw Error('Floor-plan preview is local synthetic only.');
if (
  process.env.STAFF_FLOOR_REPLY_FAULT !== undefined &&
  process.env.STAFF_FLOOR_REPLY_FAULT !== 'invalid-first-floor-plan-v1'
)
  throw Error('Unsupported synthetic floor-plan reply fault.');
const root = fileURLToPath(new URL('../', import.meta.url)),
  port = 3139;
if (existsSync(new URL('../apps/admin/.next/dev/lock', import.meta.url)))
  throw Error('Admin development directory is occupied.');
const envFile = new URL('../apps/admin/next-env.d.ts', import.meta.url),
  envBytes = readFileSync(envFile);
const rootDirectory =
  process.env.STAFF_FLOOR_ROOT ?? (await mkdtemp(path.join(os.tmpdir(), 'realtor-floor-preview-')));
const powerShellPath =
  process.env.REALTOR_TEST_POWERSHELL ??
  path.join(
    os.homedir(),
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'native',
    'powershell',
    'pwsh.exe',
  );
const fixture = await startStaffPreview({
  port: 0,
  actor: 'agent',
  tenantSlug: process.env.TENANT_SLUG ?? 'realtime-estates',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  nativeFloorPlan: { mode: 'synthetic-native-v1', rootDirectory, powerShellPath },
  ...(process.env.STAFF_FLOOR_REPLY_FAULT === 'invalid-first-floor-plan-v1'
    ? { floorPlanReplyFault: process.env.STAFF_FLOOR_REPLY_FAULT }
    : {}),
});
const api = new RealtorApiClient({
    baseUrl: fixture.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic',
  }),
  options = { bearerToken: fixture.bearerToken };
try {
  const workspace = await api.getStaffDraftWorkspaceV2(fixture.listingId, 1, options),
    catalogue = await api.getSyntheticReferenceCatalogueV3('current', options),
    session = await api.getCurrentStaffSessionV2(options);
  await api.saveSyntheticReferenceDraftV3(
    {
      policy: 'synthetic-reference-draft-v1',
      operationId: randomUUID(),
      listingId: fixture.listingId,
      revision: 1,
      expectedVersion: workspace.draft.version,
      content: normalizeStaffDraftContentV2({
        ...workspace.draft.content,
        locality: null,
        location: { county: null, town: null, area: null },
      }),
      selection: {
        catalogueVersion: catalogue.version,
        location: { countyId: null, localityId: null, neighbourhoodId: null },
        amenityIds: [],
      },
    },
    catalogue,
    session.actorId,
    options,
  );
} catch (error) {
  await fixture.close();
  throw error;
}
const instance = randomUUID();
let child,
  stopping,
  restarting = false;
function launch(actor = 'agent') {
  const active = spawn(
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
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TENANT_SLUG: fixture.tenantSlug,
        STAFF_PREVIEW_MODE: 'synthetic',
        STAFF_PREVIEW_API_ORIGIN: fixture.origin,
        STAFF_PREVIEW_TOKEN: fixture.floorPlanStaff[actor].bearerToken,
        STAFF_PREVIEW_INSTANCE: instance,
        STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
        STAFF_PREVIEW_FLOOR_PLAN: 'synthetic-private-floor-plan-v1',
      },
    },
  );
  child = active;
  active.on('error', () => {
    if (child === active) void stop();
  });
  active.on('close', () => {
    if (child === active && !restarting) void stop();
  });
  console.log(
    'Synthetic floor-plan ' +
      actor +
      ' view: http://127.0.0.1:' +
      port +
      '/drafts/' +
      fixture.listingId +
      '/1/floor-plan',
  );
  console.log(
    'Read-only review: http://127.0.0.1:' +
      port +
      '/reviews/' +
      fixture.listingId +
      '/1/floor-plan',
  );
}
async function endChild() {
  const previous = child;
  child = null;
  if (previous && previous.exitCode === null && previous.signalCode === null) {
    const ended = new Promise((resolve) => previous.once('close', resolve));
    previous.kill();
    await ended;
  }
}
const lines = createInterface({ input: process.stdin });
async function stop() {
  return (stopping ??= (async () => {
    lines.close();
    await endChild();
    await fixture.close();
    writeFileSync(envFile, envBytes);
  })());
}
lines.on('line', async (line) => {
  try {
    if (line === 'quit') {
      await stop();
      process.exitCode = 0;
    } else if (['agent', 'admin', 'customer'].includes(line) && !restarting && !stopping) {
      restarting = true;
      await endChild();
      if (!stopping) launch(line);
      restarting = false;
    }
  } catch {
    console.error(
      'Synthetic floor-plan control failed; retained originals/resources are unchanged.',
    );
  }
});
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
launch();
console.log(
  'Developer controls: agent / admin / customer / quit. No HTTP administration endpoint.',
);
console.log('Synthetic owned root retained after shutdown: ' + rootDirectory);
