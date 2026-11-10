import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { startStaffPreview } from './staff-preview.mjs';
import { publishNativeGallery, publicGalleryImageUrl } from './public-gallery-fixture.mjs';
import { loadMobilePhoto } from '../../mobile/src/published-photos.ts';

test(
  'actual anonymous published gallery returns independently decoded sealed images and stops immediately on publication pause',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'realtor-public-gallery-'));
    t.diagnostic(`Owned synthetic public gallery root retained: ${root}`);
    const preview = await startStaffPreview({
      port: 0,
      actor: 'admin',
      nativeUploads: {
        mode: 'synthetic-native-v1',
        rootDirectory: root,
        powerShellPath: path.join(
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
    });
    try {
      const { api, options, property } = await publishNativeGallery(preview);
      const mobileConfig = {
        mode: 'synthetic-reference-public-v1',
        tenantSlug: 'realtime-estates',
        apiOrigin: preview.origin,
        allowLoopbackHttp: true,
        photoMode: 'synthetic-native-v1',
      };
      const hashes = [];
      for (let n = 0; n < 4; n++) {
        const url = publicGalleryImageUrl(preview, property, property.photos[n]);
        const response = await fetch(url);
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(response.headers.get('content-type'), 'image/webp');
        assert.match(response.headers.get('cache-control'), /no-store/);
        const data = Buffer.from(await response.arrayBuffer());
        const mobile = await loadMobilePhoto(
          mobileConfig,
          property,
          n,
          new AbortController().signal,
        );
        assert.equal(mobile.status, 'ready');
        assert.equal(mobile.uri, 'data:image/webp;base64,' + data.toString('base64'));
        assert.equal(mobile.index, n);
        const metadata = await sharp(data).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.width, 320 + n * 8);
        assert.equal(metadata.height, 240);
        assert.equal(metadata.exif, undefined);
        hashes.push(createHash('sha256').update(data).digest('hex'));
        assert.equal(
          (await fetch(url, { headers: { Authorization: `Bearer ${preview.bearerToken}` } }))
            .status,
          400,
        );
      }
      assert.equal(new Set(hashes).size, 4);
      const listing = await api.getStaffListingV2(property.id, options);
      const result = await api.controlListingV2(
        {
          operationId: randomUUID(),
          kind: 'set_publication',
          listingId: property.id,
          expectedListingVersion: listing.version,
          publicationStatus: 'paused',
        },
        options,
      );
      assert.equal(result.decision.outcome, 'applied');
      assert.equal(
        (await api.listPropertiesV2({ limit: 100 })).items.some((p) => p.id === property.id),
        false,
      );
      const paused = await fetch(publicGalleryImageUrl(preview, property, property.photos[0]));
      assert.equal(paused.status, 404);
      assert.equal(
        (await loadMobilePhoto(mobileConfig, property, 0, new AbortController().signal)).status,
        'unavailable',
      );
      assert.equal(paused.headers.get('content-type'), 'application/json');
      assert.equal((await paused.text()).includes(root), false);
    } finally {
      await preview.close();
    }
  },
);
