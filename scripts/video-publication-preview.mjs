import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
import { prepareVideoReview } from './video-publication-fixture.mjs';
if (process.env.NODE_ENV !== 'development') throw Error('Explicit development required.');
const p = await startStaffPreview({
  port: 0,
  actor: 'admin',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referencePublicMode: 'synthetic-reference-public-v1',
  listingVideoMode: 'synthetic-private-listing-video-v1',
  listingVideoPublicationMode: 'synthetic-listing-video-publication-v1',
});
const children = [];
try {
  const setup = await prepareVideoReview(p);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
  const env = {
    ...process.env,
    NODE_OPTIONS: '--max-old-space-size=640',
    NODE_ENV: 'development',
    TENANT_SLUG: p.tenantSlug,
  };
  children.push(
    spawn(
      process.execPath,
      [next, 'dev', '--webpack', '--port', '3134', '--hostname', '127.0.0.1'],
      {
        cwd: root + 'apps/admin',
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...env,
          STAFF_PREVIEW_MODE: 'synthetic',
          STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
          STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
          STAFF_PREVIEW_VIDEO_PUBLICATION: 'synthetic-listing-video-publication-v1',
          STAFF_PREVIEW_API_ORIGIN: p.origin,
          STAFF_PREVIEW_TOKEN: p.bearerToken,
          STAFF_PREVIEW_INSTANCE: randomUUID(),
        },
      },
    ),
  );
  children.push(
    spawn(
      process.execPath,
      [next, 'dev', '--webpack', '--port', '3135', '--hostname', '127.0.0.1'],
      {
        cwd: root + 'apps/web',
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...env,
          WEB_CATALOGUE_MODE: 'connected',
          WEB_CATALOGUE_DATA: 'synthetic',
          WEB_CATALOGUE_REFERENCE: 'synthetic-reference-public-v1',
          WEB_CATALOGUE_SEARCH: 'public-search-v1',
          WEB_CATALOGUE_VIDEO: 'synthetic-listing-video-publication-v1',
          API_ORIGIN: p.origin,
          ALLOW_LOOPBACK_API: 'true',
        },
      },
    ),
  );
  console.log(
    `Owned reviewer: http://127.0.0.1:3134/reviews/${p.listingId}/1/references/${setup.version}`,
  );
  console.log(`Owned public detail: http://127.0.0.1:3135/properties/${p.listingId}`);
  console.log('Synthetic signed setup only; no video provider contacted.');
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const c of children) c.kill();
    await p.close();
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop());
  for (const c of children) {
    c.once('error', () => void stop(1));
    c.once('exit', (code) => void stop(code === 0 ? 0 : 1));
  }
} catch (e) {
  for (const c of children) c.kill();
  await p.close();
  throw e;
}
