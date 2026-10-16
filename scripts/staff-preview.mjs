/** Synthetic development only. No persistent identity or database. Never print or persist the bearer token. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
if (process.env.NODE_ENV === 'production') throw new Error('Staff preview refuses production.');
const root = fileURLToPath(new URL('../', import.meta.url));
const actor = process.env.STAFF_PREVIEW_ACTOR ?? 'agent';
if (!['agent', 'admin'].includes(actor))
  throw new Error('Choose agent or admin for the synthetic UI launcher.');
const mediaMode = process.env.STAFF_PREVIEW_MEDIA_MODE;
if (mediaMode !== undefined && mediaMode !== 'synthetic-native-v1')
  throw new Error('Choose the explicit synthetic-native-v1 media mode or omit it.');
if (
  mediaMode === undefined &&
  (process.env.STAFF_PREVIEW_MEDIA_ROOT !== undefined ||
    process.env.STAFF_PREVIEW_POWERSHELL_PATH !== undefined)
)
  throw new Error('Media root/executable require explicit synthetic-native-v1 mode.');
const nativeUploads =
  mediaMode === undefined
    ? undefined
    : {
        mode: mediaMode,
        rootDirectory: process.env.STAFF_PREVIEW_MEDIA_ROOT,
        powerShellPath: process.env.STAFF_PREVIEW_POWERSHELL_PATH,
      };
const preview = await startStaffPreview({
  tenantSlug: process.env.TENANT_SLUG ?? 'realtime-estates',
  actor,
  seedPendingReviews: nativeUploads === undefined && actor === 'admin',
  creationReplyFault: process.env.STAFF_PREVIEW_CREATION_REPLY_FAULT,
  ...(nativeUploads === undefined ? {} : { nativeUploads }),
});
const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const child = spawn(
  process.execPath,
  [next, 'dev', 'apps/admin', '-p', '3001', '-H', '127.0.0.1'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      STAFF_PREVIEW_MODE: 'synthetic',
      STAFF_PREVIEW_MEDIA: nativeUploads ? 'synthetic' : '',
      STAFF_PREVIEW_API_ORIGIN: preview.origin,
      STAFF_PREVIEW_TOKEN: preview.bearerToken,
      STAFF_PREVIEW_INSTANCE: randomUUID(),
      TENANT_SLUG: preview.tenantSlug,
    },
  },
);
console.log(
  `Synthetic staff editor: http://127.0.0.1:3001/drafts/${preview.listingId}/${preview.revision}`,
);
console.log('Synthetic authorized listing work: http://127.0.0.1:3001/listings');
if (actor === 'admin') console.log('Synthetic moderator queue: http://127.0.0.1:3001/reviews');
console.log(
  'Disposable data; changes disappear when this preview stops. Identity expires in 30 minutes.',
);
if (nativeUploads)
  console.log(
    'Native media is synthetic and development-only. Owned media roots are retained; this preview never reuses or rotates an occupied root. Database changes still disappear on stop.',
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
  console.error('The admin preview could not start.');
  void stop();
  process.exitCode = 1;
});
child.on('exit', (code) => {
  void stop();
  process.exitCode = code ?? 0;
});
