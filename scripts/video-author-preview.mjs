/** Owned disposable author UI fixture; no production migration, provider or customer data. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
if (process.env.NODE_ENV !== 'development')
  throw Error('Explicit development environment required.');
const port = process.env.VIDEO_AUTHOR_UI_PORT ?? '3132';
if (
  !/^[1-9][0-9]{3,4}$/.test(port) ||
  Number(port) < 1024 ||
  Number(port) > 65535 ||
  ['3001', '3003'].includes(port)
)
  throw Error('Use a separate owned UI port.');
const p = await startStaffPreview({
  port: 0,
  actor: 'agent',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  listingVideoMode: 'synthetic-private-listing-video-v1',
  listingVideoReplyFault: 'invalid-first-video-v1',
});
let child;
try {
  const api = new RealtorApiClient({
      baseUrl: p.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic-preview-v1',
    }),
    auth = { bearerToken: p.bearerToken };
  const w = await api.getStaffDraftWorkspaceV2(p.listingId, 1, auth),
    cat = await api.getSyntheticReferenceCatalogueV3('current', auth);
  await api.saveSyntheticReferenceDraftV3(
    {
      policy: 'synthetic-reference-draft-v1',
      operationId: randomUUID(),
      listingId: p.listingId,
      revision: 1,
      expectedVersion: w.draft.version,
      content: normalizeStaffDraftContentV2({
        ...w.draft.content,
        locality: null,
        location: { county: null, town: null, area: null },
      }),
      selection: {
        catalogueVersion: cat.version,
        location: { countyId: null, localityId: null, neighbourhoodId: null },
        amenityIds: [],
      },
    },
    cat,
    '00000000-0000-4000-8000-000000000011',
    auth,
  );
  child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
      'dev',
      '--webpack',
      '--port',
      port,
      '--hostname',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(new URL('../apps/admin', import.meta.url)),
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=640',
        STAFF_PREVIEW_MODE: 'synthetic',
        STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
        STAFF_PREVIEW_VIDEO: 'synthetic-private-listing-video-v1',
        STAFF_PREVIEW_API_ORIGIN: p.origin,
        STAFF_PREVIEW_TOKEN: p.bearerToken,
        STAFF_PREVIEW_INSTANCE: randomUUID(),
        TENANT_SLUG: p.tenantSlug,
      },
    },
  );
  console.log(
    'Explicit signed synthetic reference adoption completed; no video provider was contacted.',
  );
  console.log(`Owned private video UI: http://127.0.0.1:${port}/drafts/${p.listingId}/1/video`);
  let closing = false;
  async function stop() {
    if (closing) return;
    closing = true;
    child.kill();
    await p.close();
  }
  process.on('SIGINT', () => void stop().finally(() => process.exit(0)));
  process.on('SIGTERM', () => void stop().finally(() => process.exit(0)));
  child.once('exit', (code) => void stop().finally(() => process.exit(code === 0 ? 0 : 1)));
  child.once('error', () => void stop().finally(() => process.exit(1)));
} catch (e) {
  child?.kill();
  await p.close();
  throw e;
}
