import { syntheticRecoveryEnvironment } from './synthetic-recovery-env.mjs';
/** Synthetic development only. No persistent identity or database. Never print or persist the bearer token. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
const recoveryEnvironment = syntheticRecoveryEnvironment();
if (process.env.NODE_ENV === 'production') throw new Error('Staff preview refuses production.');
const root = fileURLToPath(new URL('../', import.meta.url));
const referenceDraftMode = process.env.STAFF_PREVIEW_REFERENCE;
const referenceModerationMode = process.env.STAFF_PREVIEW_REFERENCE_MODERATION;
const referenceSuccessorMode = process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR;
const referenceCreationMode = process.env.STAFF_PREVIEW_REFERENCE_CREATION;
if (
  referenceSuccessorMode !== undefined &&
  (referenceSuccessorMode !== 'synthetic-reference-successor-v1' ||
    referenceDraftMode !== 'synthetic-reference-draft-v1' ||
    referenceModerationMode !== 'synthetic-reference-transition-v1')
)
  throw new Error('Successor preview requires explicit reference draft and moderation modes.');
if (
  process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR_REPLY_FAULT !== undefined &&
  (process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR_REPLY_FAULT !== 'invalid-first-successor-v1' ||
    !referenceSuccessorMode)
)
  throw new Error('Successor reply fault requires explicit reference successor mode.');
if (
  referenceCreationMode !== undefined &&
  (referenceCreationMode !== 'synthetic-reference-creation-v1' ||
    referenceDraftMode !== 'synthetic-reference-draft-v1' ||
    referenceModerationMode !== 'synthetic-reference-transition-v1')
)
  throw new Error('Creation preview requires explicit reference draft and moderation modes.');
if (
  process.env.STAFF_PREVIEW_REFERENCE_CREATION_REPLY_FAULT !== undefined &&
  (process.env.STAFF_PREVIEW_REFERENCE_CREATION_REPLY_FAULT !== 'invalid-first-created-v1' ||
    !referenceCreationMode)
)
  throw new Error('Creation reply fault requires explicit reference creation mode.');
if (
  referenceModerationMode !== undefined &&
  (referenceModerationMode !== 'synthetic-reference-transition-v1' ||
    referenceDraftMode !== 'synthetic-reference-draft-v1')
)
  throw new Error('Moderation preview requires its explicit reference draft and transition modes.');
if (referenceDraftMode !== undefined && referenceDraftMode !== 'synthetic-reference-draft-v1')
  throw new Error('Choose the explicit synthetic-reference-draft-v1 reference mode or omit it.');
const listingVideoMode = process.env.STAFF_PREVIEW_VIDEO;
const listingVideoPublicationMode = process.env.STAFF_PREVIEW_VIDEO_PUBLICATION;
if (
  listingVideoPublicationMode !== undefined &&
  (listingVideoPublicationMode !== 'synthetic-listing-video-publication-v1' ||
    listingVideoMode !== 'synthetic-private-listing-video-v1' ||
    !referenceModerationMode)
)
  throw Error('Video publication requires explicit private video and moderation modes.');
if (
  listingVideoMode !== undefined &&
  (listingVideoMode !== 'synthetic-private-listing-video-v1' || !referenceDraftMode)
)
  throw Error('Video workspace requires explicit video and reference modes.');
const uiPort = process.env.STAFF_PREVIEW_UI_PORT ?? '3001';
if (
  !/^[1-9]\d{3,4}$/.test(uiPort) ||
  Number(uiPort) < 1024 ||
  Number(uiPort) > 65535 ||
  (referenceDraftMode && uiPort === '3001')
)
  throw new Error(
    'Use an explicit reference preview UI port from 1024 to 65535, separate from ordinary port3001.',
  );
if (referenceDraftMode && existsSync(new URL('../apps/admin/.next/dev/lock', import.meta.url)))
  throw new Error(
    'Reference preview requires a separate checkout; this admin development directory is occupied.',
  );
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
  ...(referenceDraftMode ? { port: 0 } : {}),
  tenantSlug: process.env.TENANT_SLUG ?? 'realtime-estates',
  actor,
  seedPendingReviews:
    nativeUploads === undefined &&
    actor === 'admin' &&
    !referenceDraftMode &&
    !process.env.STAFF_PREVIEW_SUCCESSOR_TERMINAL,
  creationReplyFault: process.env.STAFF_PREVIEW_CREATION_REPLY_FAULT,
  successorReplyFault: process.env.STAFF_PREVIEW_SUCCESSOR_REPLY_FAULT,
  controlReplyFault: process.env.STAFF_PREVIEW_CONTROL_REPLY_FAULT,
  successorTerminalFixture: process.env.STAFF_PREVIEW_SUCCESSOR_TERMINAL,
  referenceDraftMode,
  listingVideoMode,
  listingVideoPublicationMode,
  listingVideoReplyFault: process.env.STAFF_PREVIEW_VIDEO_REPLY_FAULT,
  referenceReplyFault: process.env.STAFF_PREVIEW_REFERENCE_REPLY_FAULT,
  referenceModerationMode,
  referenceCreationMode,
  referenceSuccessorMode,
  referenceSuccessorReplyFault: process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR_REPLY_FAULT,
  referenceCreationReplyFault: process.env.STAFF_PREVIEW_REFERENCE_CREATION_REPLY_FAULT,
  referenceModerationReplyFault: process.env.STAFF_PREVIEW_REFERENCE_MODERATION_REPLY_FAULT,
  ...(nativeUploads === undefined ? {} : { nativeUploads }),
});
const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const child = spawn(
  process.execPath,
  [next, 'dev', 'apps/admin', '-p', uiPort, '-H', '127.0.0.1'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ...recoveryEnvironment,
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
  `Synthetic staff editor: http://127.0.0.1:${uiPort}/drafts/${preview.listingId}/${preview.revision}${referenceDraftMode ? '/references' : ''}`,
);
console.log(`Synthetic authorized listing work: http://127.0.0.1:${uiPort}/listings`);
if (referenceSuccessorMode)
  console.log(
    `Synthetic reference successor: http://127.0.0.1:${uiPort}/listings/${preview.listingId}/successor`,
  );
if (referenceCreationMode)
  console.log(`Synthetic reference creation: http://127.0.0.1:${uiPort}/listings/new`);
if (referenceModerationMode)
  console.log(
    `Synthetic saved reference review: http://127.0.0.1:${uiPort}/reviews/${preview.listingId}/${preview.revision}/references/${preview.referenceReviewVersion}`,
  );
if (actor === 'admin') console.log(`Synthetic moderator queue: http://127.0.0.1:${uiPort}/reviews`);
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
