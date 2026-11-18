import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSyntheticEnquiry, RealtorApiClient } from '@realtor/api-client';
import {
  createCatalogueLoader,
  resolveCatalogueConfig,
} from '../../web/dist/tests/lib/catalogue.js';
import {
  authorizePublicIntake,
  publicIntakeConfig,
} from '../../web/dist/tests/lib/intake-config.js';
import {
  ENQUIRY_PREVIEW_FIXTURES,
  STAFF_PREVIEW_FIXTURES,
  startStaffPreview,
} from './staff-preview.mjs';
import { publicGalleryImageUrl, publishNativeGallery } from './public-gallery-fixture.mjs';

const notFound = (error) => error.status === 404;

test(
  'two companies can publish a new listing and take its web enquiry through to a confirmed viewing',
  {
    skip: process.platform !== 'win32',
    timeout: 180_000,
  },
  async (t) => {
    let previous;
    for (const tenantSlug of ['realtime-estates', 'sample-homes']) {
      await t.test(tenantSlug, async () => {
        const rootDirectory = await mkdtemp(join(tmpdir(), 'realtor-web-admin-pilot-'));
        const preview = await startStaffPreview({
          port: 0,
          tenantSlug,
          journeyFixture: 'web-admin-pilot-v1',
          enquiryPreview: 'synthetic-v1',
          enquiryCatalogue: 'synthetic-v1',
          nativeUploads: {
            mode: 'synthetic-native-v1',
            rootDirectory,
            powerShellPath: join(
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
          const admin = { bearerToken: preview.enquiryStaff.admin.bearerToken };
          const agent = { bearerToken: preview.enquiryStaff.agent.bearerToken };
          const notice = 'synthetic-staff-notice-v1';
          const api = new RealtorApiClient({
            baseUrl: preview.origin,
            privacyNoticeVersion: notice,
            allowLoopbackHttp: true,
          });
          const web = createCatalogueLoader(
            resolveCatalogueConfig({
              NODE_ENV: 'test',
              TENANT_SLUG: tenantSlug,
              WEB_CATALOGUE_MODE: 'connected',
              WEB_CATALOGUE_DATA: 'synthetic',
              WEB_CATALOGUE_SEARCH: 'public-search-v1',
              API_ORIGIN: preview.origin,
              ALLOW_LOOPBACK_API: 'true',
            }),
          );
          const listingId = randomUUID();
          const title = 'Pilot studio for ' + tenantSlug;
          const draft = await api.createListingV2(
            {
              listingId,
              operationId: randomUUID(),
              slug: 'pilot-studio-' + tenantSlug,
              content: {
                title,
                description: 'Synthetic open-plan studio with a private bathroom.',
                purpose: 'rent',
                propertyType: 'studio',
                currency: 'KES',
                amountMinor: 2000001,
                rentPeriod: 'month',
                bedrooms: 0,
                privateBathrooms: 1,
                country: 'KE',
                locality: 'Nairobi',
                publicPrecision: 'area',
                privateAddress: 'SYNTHETIC PRIVATE PILOT ADDRESS',
                pricing: { declaration: 'complete', charges: [] },
                location: { county: 'Nairobi', town: 'Nairobi', area: 'Pilot area' },
              },
            },
            agent,
          );
          assert.equal(draft.outcome, 'created');
          assert.equal((await web.detail(listingId)).status, 'not_found');

          const { property } = await publishNativeGallery(preview, {
            listingId,
            author: agent.bearerToken,
            reviewer: admin.bearerToken,
          });
          const discovery = await web.list({
            purpose: 'rent',
            period: 'month',
            type: 'studio',
            beds: '0',
          });
          assert.equal(discovery.mode, 'connected');
          assert.ok(discovery.items.some(({ id }) => id === listingId));
          const detail = await web.detail(listingId);
          assert.equal(detail.status, 'found');
          assert.equal(property.title, title);
          assert.equal(property.amountMinor, 2000001);
          assert.equal(property.bedrooms, 0);
          assert.ok(!JSON.stringify(detail).includes('SYNTHETIC PRIVATE PILOT ADDRESS'));
          const image = await fetch(publicGalleryImageUrl(preview, property, property.photos[0]));
          assert.equal(image.status, 200);
          assert.match(image.headers.get('content-type'), /^image\/webp/);
          assert.ok((await image.arrayBuffer()).byteLength > 0);

          const form = {
            listingId,
            name: 'Synthetic pilot prospect',
            email: 'pilot@example.invalid',
            phone: null,
            message: 'I would like to arrange a viewing.',
            origin: 'web',
            noticeVersion: notice,
            noticeAcknowledged: true,
          };
          const intake = publicIntakeConfig({
            NODE_ENV: 'development',
            TENANT_SLUG: tenantSlug,
            WEB_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
            WEB_ENQUIRY_PROPERTY_MODE: 'synthetic-v1',
            WEB_ENQUIRY_INSTANCE: randomUUID(),
            WEB_ENQUIRY_API_ORIGIN: preview.origin,
            WEB_CATALOGUE_MODE: 'connected',
            WEB_CATALOGUE_DATA: 'synthetic',
            API_ORIGIN: preview.origin,
          });
          const key = randomUUID();
          const submit = (attemptKey = key) =>
            handleSyntheticEnquiry(
              new Request('http://127.0.0.1:3000/api/enquiry-intake', {
                method: 'POST',
                headers: {
                  host: '127.0.0.1:3000',
                  origin: 'http://127.0.0.1:3000',
                  'x-preview-instance': intake.instanceId,
                  'idempotency-key': attemptKey,
                  'content-type': 'application/json',
                },
                body: JSON.stringify(form),
              }),
              {
                ...intake,
                authorize: (request) => authorizePublicIntake(request, intake.instanceId),
              },
            );
          const receipt = await submit();
          assert.equal(receipt.status, 201);
          const { id: enquiryId } = await receipt.json();
          assert.deepEqual(await (await submit()).json(), { id: enquiryId });
          const enquiry = await api.getStaffEnquiryV2(enquiryId, admin);
          assert.equal(enquiry.listingId, listingId);
          assert.equal(enquiry.status, 'new');
          const assigned = await api.applyEnquiryOperationV2(
            enquiryId,
            {
              kind: 'assign',
              operationId: randomUUID(),
              expectedVersion: enquiry.version,
              assignedAgentId: preview.enquiryStaff.agent.actorId,
              status: null,
              nextActionAt: null,
              reason: null,
            },
            admin,
          );
          assert.equal(assigned.outcome, 'applied');

          const requested = await api.requestViewingV2(
            enquiryId,
            {
              operationId: randomUUID(),
              expectedEnquiryVersion: assigned.result.version,
              listingId,
              preferredSlots: [],
              notes: 'Synthetic web enquiry follow-up.',
            },
            agent,
          );
          const slot = {
            startAt: '2090-01-01T09:00:00.000Z',
            endAt: '2090-01-01T10:00:00.000Z',
            timeZone: 'Africa/Nairobi',
          };
          const proposed = await api.proposeViewingV2(
            enquiryId,
            requested.viewingId,
            {
              operationId: randomUUID(),
              expectedVersion: requested.result.version,
              slot,
            },
            agent,
          );
          const confirmed = await api.confirmViewingV2(
            enquiryId,
            requested.viewingId,
            {
              operationId: randomUUID(),
              expectedVersion: proposed.result.version,
              slot,
              channel: 'phone',
              agreedAt: proposed.completedAt,
              notes: 'Synthetic prospect agreed.',
            },
            agent,
          );
          assert.equal(confirmed.result.status, 'confirmed');
          const viewing = await api.getViewingV2(enquiryId, requested.viewingId, admin);
          assert.equal(viewing.schedule.status, 'confirmed');

          const listing = await api.getStaffListingV2(listingId, admin);
          const paused = await api.controlListingV2(
            {
              operationId: randomUUID(),
              kind: 'set_publication',
              listingId,
              expectedListingVersion: listing.version,
              publicationStatus: 'paused',
            },
            admin,
          );
          assert.equal(paused.decision.outcome, 'applied');
          assert.equal((await web.detail(listingId)).status, 'not_found');
          const pausedResults = await web.list({
            purpose: 'rent',
            period: 'month',
            type: 'studio',
            beds: '0',
          });
          assert.equal(pausedResults.mode, 'connected');
          assert.ok(!pausedResults.items.some(({ id }) => id === listingId));
          assert.equal(
            (await fetch(publicGalleryImageUrl(preview, property, property.photos[0]))).status,
            404,
          );

          const unavailable = await submit(randomUUID());
          assert.equal(unavailable.status, 404);
          assert.equal((await unavailable.json()).error.code, 'NOT_FOUND');
          const original = await submit();
          assert.equal(original.status, 201);
          assert.deepEqual(await original.json(), { id: enquiryId });
          assert.equal(
            (await api.getViewingV2(enquiryId, requested.viewingId, admin)).schedule.status,
            'confirmed',
          );

          // Both companies' baseline records exist inside each preview database.
          const foreignTenant = tenantSlug === 'sample-homes' ? 'realtime-estates' : 'sample-homes';
          const foreignListing =
            foreignTenant === 'sample-homes'
              ? STAFF_PREVIEW_FIXTURES.sampleListingId
              : STAFF_PREVIEW_FIXTURES.realtimeListingId;
          await assert.rejects(() => api.getStaffDraftV2(foreignListing, 1, admin), notFound);
          await assert.rejects(
            () => api.getStaffEnquiryV2(ENQUIRY_PREVIEW_FIXTURES[foreignTenant].assigned, admin),
            notFound,
          );
          if (previous) {
            assert.equal((await web.detail(previous.listingId)).status, 'not_found');
            await assert.rejects(() => api.getStaffEnquiryV2(previous.enquiryId, admin), notFound);
            await assert.rejects(
              () => api.getViewingV2(previous.enquiryId, previous.viewingId, admin),
              notFound,
            );
          }
          previous = { listingId, enquiryId, viewingId: requested.viewingId };
        } finally {
          await preview.close();
        }
      });
    }
  },
);
