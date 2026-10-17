import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createIdentityVerifier } from '../dist/auth.js';
import { PostgresTransactionDatabase } from '../dist/database.js';
import { createApiService } from '../dist/service.js';
import { createDevelopmentServer } from '../dist/http.js';
import { createDevelopmentUploadApi } from '../dist/upload.js';
import { createDevelopmentMediaFinalizeApi } from '../dist/media-finalize.js';
import { createDevelopmentReviewMediaPreviewApi } from '../dist/media-preview.js';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
import { createDurableSyntheticStore } from '@realtor/media/durable-store';
import { createSyntheticAttemptJournal } from '@realtor/media/attempt-journal';
import { createSyntheticWorkerAdmission } from '@realtor/media/worker-admission';
import { createSyntheticOneAttemptProcessor } from '@realtor/media/one-attempt';
import { createSyntheticUploadRequests } from '@realtor/media/upload-request';
import { createSyntheticProcessingRequests } from '@realtor/media/processing-request';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
import { environment, WINDOWS_ONLY } from '../../../packages/media/tests/coordinator-fixture.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  AGENT = id(11),
  ADMIN = id(10),
  L = id(100);

test(
  'signed reviewer native read denies post-IO demotion, restores exact pending read, and denies a decision made during IO',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t),
      parent = await mkdtemp(path.join(tmpdir(), 'realtor-review-native-'));
    t.diagnostic(`Owned reviewer native storage retained: ${parent}`);
    const stores = [];
    let journal,
      worker,
      ledger,
      processingRequests,
      upload,
      finalize,
      images,
      server,
      jwks,
      gate,
      sqlActive = false,
      nativeCalls = 0;
    t.after(async () => {
      gate?.release();
      for (const s of [server, jwks])
        if (s) {
          s.closeAllConnections();
          await new Promise((resolve) => s.close(resolve));
        }
      await images?.close();
      await upload?.close();
      await finalize?.close();
      await ledger?.close();
      await processingRequests?.close();
      await worker?.close();
      await journal?.close();
      for (const store of stores) await store.close();
    });
    const store = async () => {
      const s = await createDurableSyntheticStore(parent);
      stores.push(s);
      return s;
    };
    const photos = await store(),
      processing = await store(),
      journalStore = await store(),
      transport = await store();
    journal = await createSyntheticAttemptJournal({
      store: journalStore,
      attemptParent: e.attemptParent,
    });
    worker = await createSyntheticWorkerAdmission({ parentDirectory: parent, journal });
    ledger = await createSyntheticUploadRequests({ store: transport });
    processingRequests = await createSyntheticProcessingRequests({ store: processing });
    await e.asBootstrap(async (db) => {
      await db.query(
        "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
        [T, ADMIN],
      );
      await db.exec(
        'CREATE ROLE synthetic_review_api_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO synthetic_review_api_login;',
      );
    });
    // One PGlite session, deliberately sequenced. These are separate completed
    // authorization/mutation transactions around real IO, not multi-session PG races.
    const database = {
      async transaction(context, operation) {
        assert.equal(sqlActive, false);
        return e.asBootstrap(async (db) => {
          await db.exec('SET SESSION AUTHORIZATION synthetic_review_api_login;RESET ROLE;');
          sqlActive = true;
          try {
            return await new PostgresTransactionDatabase({
              async connect() {
                return { query: (sql, args) => db.query(sql, args ? [...args] : []), release() {} };
              },
            }).transaction(context, operation);
          } finally {
            sqlActive = false;
          }
        });
      },
    };
    const keys = await generateKeyPair('RS256'),
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: 'synthetic-review-native',
        alg: 'RS256',
        use: 'sig',
      };
    jwks = createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    const issuer = `http://127.0.0.1:${jwks.address().port}`;
    const verifyBearer = createIdentityVerifier({
      issuer,
      audience: 'synthetic-review-native',
      jwksUrl: issuer + '/jwks',
      allowLoopbackHttpForTests: true,
    });
    const token = async (actor) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(issuer)
        .setAudience('synthetic-review-native')
        .setSubject(actor)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    const agentToken = await token(AGENT),
      adminToken = await token(ADMIN),
      tenant = { tenantId: T, slug: 'synthetic-review-native', hostnames: ['127.0.0.1'] };
    const createProcessor = () =>
      createSyntheticOneAttemptProcessor({
        coordinator: e.coordinator,
        inputStore: photos,
        requestStore: processing,
        worker,
        journal,
        supervisor: {
          async run(request) {
            assert.equal(sqlActive, false);
            nativeCalls++;
            return e.run(request.workingDirectory);
          },
        },
        nodeExecutablePath: process.execPath,
        codecEntryPath: fileURLToPath(
          new URL('../../../packages/media/dist/codec-worker.js', import.meta.url),
        ),
      });
    upload = createDevelopmentUploadApi({
      tenant,
      database,
      verifyBearer,
      requests: ledger,
      createProcessor,
    });
    finalize = createDevelopmentMediaFinalizeApi({
      tenant,
      database,
      verifyBearer,
      coordinator: e.coordinator,
    });
    let outputReads = 0;
    images = createDevelopmentReviewMediaPreviewApi({
      tenant,
      database,
      verifyBearer,
      processingRequests,
      outputStore: {
        storeId: photos.storeId,
        async read(reference) {
          assert.equal(sqlActive, false);
          const bytes = await photos.read(reference);
          outputReads++;
          const held = gate;
          if (held) {
            held.enter();
            await held.wait;
          }
          return bytes;
        },
      },
    });
    const service = createApiService({
      tenantId: T,
      privacyNoticeVersion: 'synthetic-v1',
      database,
      verifyAuthorization: (request) =>
        verifyBearer(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''),
    });
    server = createDevelopmentServer(
      (request) =>
        new URL(request.url).pathname.endsWith('/finalize')
          ? finalize.handle(request)
          : service(request),
      new WeakMap(),
      (request, source) => upload.handle(request, source),
      (request) => images.handle(request),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`,
      api = new RealtorApiClient({
        baseUrl: origin,
        privacyNoticeVersion: 'synthetic-v1',
        allowLoopbackHttp: true,
      }),
      agent = { bearerToken: agentToken },
      admin = { bearerToken: adminToken };
    const pixels = syntheticPng(43, 31, (x, y) => [x * 5, y * 7, 80, 255]);
    const uploaded = await fetch(
      origin + `/v2/staff/listings/${L}/revisions/1/media-jobs/${e.jobId}/uploads/${randomUUID()}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${agentToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: pixels,
      },
    );
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    assert.equal(nativeCalls, 1);
    const operationId = randomUUID();
    await api.createMediaAttachIntentV2(
      L,
      1,
      { operationId, jobId: e.jobId, expectedVersion: '2' },
      agent,
    );
    const attached = await api.finalizeMediaAttachIntentV2(L, 1, operationId, agent);
    assert.equal(attached.status, 'applied');
    // Only the target photo has native bytes. Three relational sealed fixtures
    // satisfy submission shape; no bytes/decode claim is made for these extras.
    await e.asBootstrap(async (db) => {
      for (let position = 1; position < 4; position++)
        await seedSyntheticSealedMedia(db, { tenantId: T, listingId: L, revision: 1, position });
    });
    const submitted = await api.submitStaffDraftV2(
      L,
      1,
      { expectedVersion: attached.receipt.version },
      agent,
    );
    const gallery = await api.getReviewMediaGalleryV2(L, 1, submitted.version, admin),
      media = attached.receipt.mediaId;
    assert.ok(gallery.photos.some((photo) => photo.id === media));
    const read = () =>
      fetch(origin + `/v2/staff/reviews/${L}/1/media/${media}/preview`, {
        headers: { Authorization: `Bearer ${adminToken}`, 'X-Revision-Version': submitted.version },
      });
    const baseline = await read();
    assert.equal(baseline.status, 200);
    const expected = Buffer.from(await baseline.arrayBuffer());
    assert.equal(expected.toString('ascii', 8, 12), 'WEBP');
    const hold = () => {
      let enter, release;
      const entered = new Promise((resolve) => {
          enter = resolve;
        }),
        wait = new Promise((resolve) => {
          release = resolve;
        });
      gate = { enter, release, wait };
      return {
        entered,
        release: () => {
          gate = undefined;
          release();
        },
      };
    };
    const denied = async (response) => {
      assert.equal(response.status, 404);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const body = await response.text();
      assert.equal(body.includes('RIFF'), false);
      assert.equal(body.includes('synthetic_review_api_login'), false);
    };
    const demotion = hold(),
      pending = read();
    await demotion.entered;
    assert.equal(sqlActive, false);
    await e.asBootstrap((db) =>
      db.query(
        "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
        [T, ADMIN],
      ),
    );
    demotion.release();
    await denied(await pending);
    await e.asBootstrap((db) =>
      db.query(
        "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
        [T, ADMIN],
      ),
    );
    const restored = await read();
    assert.equal(restored.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await restored.arrayBuffer()))
        .digest('hex'),
      createHash('sha256').update(expected).digest('hex'),
    );
    const decision = hold(),
      second = read();
    await decision.entered;
    assert.equal(sqlActive, false);
    const result = await api.decideReviewV2(
      L,
      1,
      {
        expectedVersion: submitted.version,
        decision: 'reject',
        reason: 'Synthetic native race verification',
      },
      admin,
    );
    assert.equal(result.state, 'rejected');
    decision.release();
    await denied(await second);
    await denied(await read());
    assert.equal(outputReads, 4, 'Decided follow-up is denied before another store read.');
    assert.equal(nativeCalls, 1, 'Image reads never launch another decoder.');
  },
);
