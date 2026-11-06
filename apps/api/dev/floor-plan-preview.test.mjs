import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from './staff-preview.mjs';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
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
test(
  'signed native floor-plan preview prepares >64KiB source, recovers lost upload/attach replies and reads/removes actual stored image',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'realtor-floor-preview-'));
    let fixture,
      closed = false;
    t.after(async () => {
      if (fixture) {
        await fixture.close();
        closed = true;
      }
      if (!closed) {
        t.diagnostic('Unconfirmed initialization root retained: ' + root);
        return;
      }
      async function clean(dir) {
        assert.ok(path.resolve(dir) === root || path.resolve(dir).startsWith(root + path.sep));
        assert.ok(!(await lstat(dir)).isSymbolicLink());
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name),
            s = await lstat(p);
          assert.ok(!s.isSymbolicLink());
          if (s.isDirectory()) await clean(p);
          else {
            assert.ok(s.isFile() && s.nlink === 1);
            await unlink(p);
          }
        }
        await rmdir(dir);
      }
      await clean(root);
    });
    fixture = await startStaffPreview({
      port: 0,
      actor: 'agent',
      referenceDraftMode: 'synthetic-reference-draft-v1',
      nativeFloorPlan: { mode: 'synthetic-native-v1', rootDirectory: root, powerShellPath },
      floorPlanReplyFault: 'invalid-first-floor-plan-v1',
    });
    assert.equal(fixture.nativeFloorPlan, true);
    assert.ok(!JSON.stringify(fixture).includes(fixture.bearerToken));
    const api = new RealtorApiClient({
        baseUrl: fixture.origin,
        allowLoopbackHttp: true,
        privacyNoticeVersion: 'synthetic',
      }),
      options = { bearerToken: fixture.bearerToken, timeoutMs: 60000 };
    const workspace = await api.getStaffDraftWorkspaceV2(fixture.listingId, 1, options),
      command = {
        policy: 'synthetic-floor-plan-preparation-command-v1',
        listingId: fixture.listingId,
        revision: 1,
        expectedVersion: workspace.draft.version,
        requestId: randomUUID(),
      };
    let seed = 123;
    const source = syntheticPng(256, 256, () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return [seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255];
    });
    assert.ok(source.length > 65536);
    await assert.rejects(
      api.prepareFloorPlan(command, source, options),
      (e) => e.submissionUncertain === true,
    );
    const prepared = await api.getFloorPlanPreparationOriginal(command, options);
    assert.equal(prepared.width, 256);
    assert.equal(prepared.requestId, command.requestId);
    const attachment = {
      policy: 'synthetic-floor-plan-attachment-command-v1',
      listingId: command.listingId,
      revision: 1,
      expectedVersion: command.expectedVersion,
      operationId: randomUUID(),
      requestId: command.requestId,
    };
    await assert.rejects(
      api.saveFloorPlanAttachment(attachment, options),
      (e) => e.submissionUncertain === true,
    );
    const saved = await api.getFloorPlanAttachmentOriginal(attachment, options),
      state = await api.getFloorPlan(command.listingId, 1, options);
    assert.equal(state.version, saved.resultVersion);
    assert.equal(state.floorPlan.sha256, prepared.sha256);
    const url =
      fixture.origin +
      `/v2/staff/listings/${command.listingId}/floor-plan-images/1/${attachment.operationId}`;
    for (const entry of Object.values(fixture.floorPlanStaff)) {
      assert.equal(Object.getOwnPropertyDescriptor(entry, 'bearerToken').enumerable, false);
      assert.ok(!JSON.stringify(fixture.floorPlanStaff).includes(entry.bearerToken));
    }
    const adminState = await api.getFloorPlan(command.listingId, 1, {
      bearerToken: fixture.floorPlanStaff.admin.bearerToken,
    });
    assert.equal(adminState.floorPlan.sha256, prepared.sha256);
    assert.equal(
      (
        await fetch(url, {
          headers: { authorization: 'Bearer ' + fixture.floorPlanStaff.admin.bearerToken },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(url, {
          headers: { authorization: 'Bearer ' + fixture.floorPlanStaff.customer.bearerToken },
        })
      ).status,
      403,
    );
    const image = await fetch(url, { headers: { authorization: 'Bearer ' + fixture.bearerToken } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.equal((await image.arrayBuffer()).byteLength, prepared.bytes);
    const removal = await api.saveFloorPlanAttachment(
      { ...attachment, operationId: randomUUID(), expectedVersion: state.version, requestId: null },
      options,
    );
    assert.equal(removal.floorPlan, null);
    assert.equal((await api.getFloorPlan(command.listingId, 1, options)).floorPlan, null);
    assert.equal(
      (await fetch(url, { headers: { authorization: 'Bearer ' + fixture.bearerToken } })).status,
      404,
    );
  },
);

test('native floor preview refuses omitted reference mode, mixed photo mode, unsupported configuration and reply fault without capability', async () => {
  for (const options of [
    {
      nativeFloorPlan: { mode: 'synthetic-native-v1', rootDirectory: os.tmpdir(), powerShellPath },
    },
    {
      referenceDraftMode: 'synthetic-reference-draft-v1',
      nativeFloorPlan: { mode: 'wrong', rootDirectory: os.tmpdir(), powerShellPath },
    },
    {
      referenceDraftMode: 'synthetic-reference-draft-v1',
      nativeFloorPlan: { mode: 'synthetic-native-v1', rootDirectory: 'relative', powerShellPath },
    },
    { referenceDraftMode: 'synthetic-reference-draft-v1', nativeUploads: {}, nativeFloorPlan: {} },
    { floorPlanReplyFault: 'invalid-first-floor-plan-v1' },
  ])
    await assert.rejects(startStaffPreview({ ...options, port: 0 }));
});

test(
  'native floor constructor discards an unsafe coordinator checkout before any root mutation',
  { skip: process.platform !== 'win32' },
  async () => {
    const { createNativeFloorPlanPreview } = await import('./media-preview.mjs');
    let discarded;
    await assert.rejects(
      createNativeFloorPlanPreview({
        nativeFloorPlan: {
          mode: 'synthetic-native-v1',
          rootDirectory: os.tmpdir(),
          powerShellPath,
        },
        tenantId: '00000000-0000-4000-8000-000000000001',
        database: {
          transaction: async () => {
            throw Error('Unexpected API transaction');
          },
        },
        mediaPool: {
          connect: async () => ({
            query: async () => ({ rows: [] }),
            release: (value) => {
              discarded = value;
            },
          }),
        },
      }),
      (e) => e.code === 'UNSAFE_MEDIA_COORDINATOR_ROLE',
    );
    assert.equal(discarded, true);
  },
);

test(
  'signed adopted-reference native preview reviews and publishes retained floor bytes after approval and denies after pause',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'realtor-floor-public-'));
    let p,
      closed = false;
    t.after(async () => {
      if (p) {
        await p.close();
        closed = true;
      }
      if (!closed) {
        t.diagnostic('Unconfirmed root retained: ' + root);
        return;
      }
      async function clean(dir) {
        assert.ok(path.resolve(dir) === root || path.resolve(dir).startsWith(root + path.sep));
        assert.ok(!(await lstat(dir)).isSymbolicLink());
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const target = path.join(dir, entry.name),
            s = await lstat(target);
          assert.ok(!s.isSymbolicLink());
          if (s.isDirectory()) await clean(target);
          else {
            assert.ok(s.isFile() && s.nlink === 1);
            await unlink(target);
          }
        }
        await rmdir(dir);
      }
      await clean(root);
    });
    p = await startStaffPreview({
      port: 0,
      actor: 'agent',
      referenceDraftMode: 'synthetic-reference-draft-v1',
      nativeFloorPlan: { mode: 'synthetic-native-v1', rootDirectory: root, powerShellPath },
      floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1',
      floorPlanReferenceJourney: 'synthetic-floor-plan-reference-journey-v1',
      referenceModerationMode: 'synthetic-reference-transition-v1',
    });
    assert.equal(p.syntheticFloorPlanPublication, true);
    const api = new RealtorApiClient({
        baseUrl: p.origin,
        allowLoopbackHttp: true,
        privacyNoticeVersion: 'synthetic',
      }),
      opt = { bearerToken: p.bearerToken, timeoutMs: 60000 },
      admin = { bearerToken: p.floorPlanStaff.admin.bearerToken };
    const initial = await api.getStaffDraftWorkspaceV2(p.listingId, 1, opt),
      catalogue = await api.getSyntheticReferenceCatalogueV3('current', opt),
      session = await api.getCurrentStaffSessionV2(opt);
    assert.equal(initial.draft.version, '2');
    assert.equal(p.referenceReviewVersion, undefined);
    assert.equal(p.syntheticFloorPlanReferenceJourney, true);
    const county = catalogue.locations.find((r) => r.kind === 'county'),
      town = catalogue.locations.find((r) => r.kind === 'locality'),
      area = catalogue.locations.find((r) => r.kind === 'neighbourhood');
    await api.saveSyntheticReferenceDraftV3(
      {
        policy: 'synthetic-reference-draft-v1',
        operationId: randomUUID(),
        listingId: p.listingId,
        revision: 1,
        expectedVersion: initial.draft.version,
        content: normalizeStaffDraftContentV2({
          ...initial.draft.content,
          locality: area.label,
          location: { county: county.label, town: town.label, area: area.label },
        }),
        selection: {
          catalogueVersion: catalogue.version,
          location: { countyId: county.id, localityId: town.id, neighbourhoodId: area.id },
          amenityIds: [],
        },
      },
      catalogue,
      session.actorId,
      opt,
    );
    const draft = await api.getStaffDraftWorkspaceV2(p.listingId, 1, opt),
      prep = {
        policy: 'synthetic-floor-plan-preparation-command-v1',
        listingId: p.listingId,
        revision: 1,
        expectedVersion: draft.draft.version,
        requestId: randomUUID(),
      };
    const prepared = await api.prepareFloorPlan(prep, syntheticPng(256, 256), opt);
    const attached = await api.saveFloorPlanAttachment(
      {
        policy: 'synthetic-floor-plan-attachment-command-v1',
        listingId: p.listingId,
        revision: 1,
        expectedVersion: prep.expectedVersion,
        operationId: randomUUID(),
        requestId: prep.requestId,
      },
      opt,
    );
    await assert.rejects(() => api.getPublishedFloorPlan(p.listingId, 1));
    const before = await api.getRevisionProtocolV3(p.listingId, 1, opt);
    assert.equal(
      (
        await api.controlListingV2(
          {
            kind: 'confirm_availability',
            operationId: randomUUID(),
            listingId: p.listingId,
            expectedListingVersion: before.listingVersion,
            availability: 'available',
          },
          opt,
        )
      ).decision.outcome,
      'applied',
    );
    const submitContext = await api.getSyntheticReferenceRevisionContextV3(
      p.listingId,
      1,
      attached.resultVersion,
      opt,
    );
    const pendingReceipt = await api.transitionSyntheticReferenceRevisionV3(
      {
        policy: 'synthetic-reference-transition-v1',
        operationId: randomUUID(),
        listingId: p.listingId,
        revision: 1,
        review: submitContext.review,
        action: 'submit',
        reason: null,
      },
      submitContext.catalogue,
      session.actorId,
      opt,
    );
    const pending = { version: pendingReceipt.revisionVersion };
    assert.equal(
      (await api.getReviewFloorPlan(p.listingId, 1, pending.version, admin)).state,
      'pending',
    );
    await assert.rejects(
      () => api.getReviewFloorPlan(p.listingId, 1, pending.version, opt),
      (e) => e.status === 403,
    );
    const reviewImageUrl = p.origin + `/v2/staff/reviews/${p.listingId}/1/floor-plan-image/`;
    const reviewBytes = await fetch(reviewImageUrl + pending.version, {
      headers: { authorization: 'Bearer ' + admin.bearerToken },
    });
    assert.equal(reviewBytes.status, 200);
    assert.equal((await reviewBytes.arrayBuffer()).byteLength, prepared.bytes);
    assert.equal(
      (
        await fetch(reviewImageUrl + pending.version, {
          headers: { authorization: 'Bearer ' + p.bearerToken },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(reviewImageUrl + pending.version, {
          headers: { authorization: 'Bearer ' + p.floorPlanStaff.customer.bearerToken },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(reviewImageUrl + pending.version)).status, 401);
    const reviewContext = await api.getSyntheticReferenceReviewContextV3(
      p.listingId,
      1,
      pending.version,
      admin,
    );
    const approvedReceipt = await api.transitionSyntheticReferenceRevisionV3(
      {
        policy: 'synthetic-reference-transition-v1',
        operationId: randomUUID(),
        listingId: p.listingId,
        revision: 1,
        review: reviewContext.review,
        action: 'approve',
        reason: null,
      },
      reviewContext.catalogue,
      p.floorPlanStaff.admin.actorId,
      admin,
    );
    const approved = { version: approvedReceipt.revisionVersion };
    const approvedReviewBytes = await fetch(reviewImageUrl + approved.version, {
      headers: { authorization: 'Bearer ' + admin.bearerToken },
    });
    assert.equal(approvedReviewBytes.status, 200);
    assert.equal((await approvedReviewBytes.arrayBuffer()).byteLength, prepared.bytes);
    assert.equal(
      (
        await fetch(reviewImageUrl + pending.version, {
          headers: { authorization: 'Bearer ' + admin.bearerToken },
        })
      ).status,
      409,
    );
    const published = await api.getPublishedFloorPlan(p.listingId, 1);
    assert.equal(published.approvedVersion, approved.version);
    assert.equal(published.floorPlan.sha256, prepared.sha256);
    const url =
      p.origin + `/v3/properties/${p.listingId}/revisions/1/floor-plan-image/${approved.version}`;
    const image = await fetch(url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    const data = Buffer.from(await image.arrayBuffer());
    const { createHash } = await import('node:crypto');
    assert.equal(data.length, prepared.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), prepared.sha256);
    assert.equal(data.toString('latin1', 8, 12), 'WEBP');
    assert.equal(
      (await fetch(url, { headers: { authorization: 'Bearer ' + p.bearerToken } })).status,
      400,
    );
    assert.equal((await fetch(url.replace('/' + approved.version, '/1'))).status, 404);
    assert.equal(
      (await api.getReviewFloorPlan(p.listingId, 1, approved.version, admin)).state,
      'approved',
    );
    const current = await api.getRevisionProtocolV3(p.listingId, 1, admin);
    assert.equal(
      (
        await api.controlListingV2(
          {
            kind: 'set_publication',
            operationId: randomUUID(),
            listingId: p.listingId,
            expectedListingVersion: current.listingVersion,
            publicationStatus: 'paused',
          },
          admin,
        )
      ).decision.outcome,
      'applied',
    );
    assert.equal((await fetch(url)).status, 404);
    await assert.rejects(() => api.getPublishedFloorPlan(p.listingId, 1));
    t.diagnostic(
      JSON.stringify({
        syntheticPublicFloorPlan: {
          draftVersion: prep.expectedVersion,
          attachmentVersion: attached.resultVersion,
          pendingVersion: pending.version,
          approvedVersion: approved.version,
          width: prepared.width,
          height: prepared.height,
          bytes: prepared.bytes,
          sha256: prepared.sha256,
          pausedStatus: 404,
        },
      }),
    );
    const entries = await readdir(path.join(root, 'attempts'));
    assert.equal(entries.length, 1, 'Publication does not reprocess the original source');
  },
);

test('floor publication composition refuses unsupported mode and missing native capability', async () => {
  await assert.rejects(() =>
    startStaffPreview({ port: 0, floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1' }),
  );
  await assert.rejects(() => startStaffPreview({ port: 0, floorPlanPublicationMode: 'live' }));
});

test('reference floor journey rejects orphan and unsupported combinations before resources', async () => {
  for (const options of [
    { floorPlanReferenceJourney: 'synthetic-floor-plan-reference-journey-v1' },
    { floorPlanReferenceJourney: 'wrong' },
    {
      floorPlanReferenceJourney: 'synthetic-floor-plan-reference-journey-v1',
      floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1',
    },
  ])
    await assert.rejects(() => startStaffPreview({ ...options, port: 0 }));
});

test('interactive floor launcher refuses unsupported author-start journey before native startup', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const r = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../../../scripts/floor-plan-preview.mjs', import.meta.url))],
    {
      env: { ...process.env, NODE_ENV: 'development', STAFF_FLOOR_REFERENCE_JOURNEY: 'wrong' },
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unsupported synthetic floor-plan reference journey/);
  assert.ok(!r.stdout.includes('Synthetic floor-plan'));
});
