import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview, ENQUIRY_PREVIEW_FIXTURES } from './staff-preview.mjs';
import { createMobileReferenceReadSession } from '../../mobile/src/reference-read-session.ts';
import {
  emptyMobileReferenceFilters,
  prepareMobileReferenceSearch,
} from '../../mobile/src/reference-search.ts';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const publicModes = {
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referencePublicMode: 'synthetic-reference-public-v1',
};
const enquiryModes = { enquiryPreview: 'synthetic-v1', enquiryCatalogue: 'synthetic-v1' };
const client = (preview) =>
  new RealtorApiClient({
    baseUrl: preview.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
  });
const ids = (page) => page.items.map((row) => row.id);
const assertIds = (page, expected) => assert.deepEqual(new Set(ids(page)), new Set(expected));
function assertFrozen(value) {
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value))
    if (child && typeof child === 'object') assertFrozen(child);
}
function inNairobiDay(instant, asOf) {
  const date = new Date(Date.parse(asOf) + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = Date.parse(date + 'T00:00:00.000+03:00');
  return Date.parse(instant) >= start && Date.parse(instant) < start + 24 * 60 * 60 * 1000;
}
async function signed(preview, path, role = 'admin', options = {}) {
  return fetch(preview.origin + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + preview.enquiryStaff[role].bearerToken,
      ...options.headers,
    },
  });
}

test('journey fixtures require exact compatible opt-ins and default public/enquiry stock stays unchanged', async () => {
  for (const options of [
    ...['', 'public-search-v1 ', 'Public-search-v1', 'unknown', true, ['public-search-v1']].map(
      (journeyFixture) => ({ journeyFixture }),
    ),
    { journeyFixture: 'public-search-v1' },
    { ...publicModes, journeyFixture: 'public-search-v1', seedAcceptedMedia: false },
    { ...publicModes, journeyFixture: 'public-search-v1', referencePublicMode: undefined },
    { journeyFixture: 'enquiry-queue-v1' },
    { enquiryPreview: 'synthetic-v1', journeyFixture: 'enquiry-queue-v1' },
    { ...enquiryModes, journeyFixture: 'public-search-v1' },
    { ...publicModes, journeyFixture: 'enquiry-queue-v1' },
  ])
    await assert.rejects(() => startStaffPreview({ port: 0, ...options }));
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      () => startStaffPreview({ port: 0, ...publicModes, journeyFixture: 'public-search-v1' }),
      /production/,
    );
    await assert.rejects(
      () => startStaffPreview({ port: 0, ...enquiryModes, journeyFixture: 'enquiry-queue-v1' }),
      /production/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  const publicPreview = await startStaffPreview({ port: 0, ...publicModes });
  try {
    assert.equal(Object.hasOwn(publicPreview, 'journeyFixture'), false);
    const page = await client(publicPreview).searchSyntheticReferencePropertiesV3({ limit: 12 });
    assert.equal(page.total, 1);
    assertIds(page, [publicPreview.referencePublicListingId]);
  } finally {
    await publicPreview.close();
  }
  const enquiryPreview = await startStaffPreview({ port: 0, ...enquiryModes });
  try {
    assert.equal(Object.hasOwn(enquiryPreview, 'journeyFixture'), false);
    const api = client(enquiryPreview);
    for (const [role, count] of [
      ['admin', 5],
      ['agent', 3],
    ]) {
      const page = await api.listStaffEnquiriesV3(
        { limit: 50 },
        { bearerToken: enquiryPreview.enquiryStaff[role].bearerToken },
      );
      assert.equal(page.items.length, count);
      assert.equal(page.hasMore, false);
    }
  } finally {
    await enquiryPreview.close();
  }
});

test('anonymous public journey stock supports real 12/12/8 pages, exact cents, grouped bedrooms, global choices and scoped detail', async () => {
  for (const [company, foreignCompany, foreignBase] of [
    ['realtime-estates', 'sample-homes', 41000],
    ['sample-homes', 'realtime-estates', 40000],
  ]) {
    const preview = await startStaffPreview({
      port: 0,
      tenantSlug: company,
      ...publicModes,
      journeyFixture: 'public-search-v1',
    });
    try {
      const api = client(preview),
        manifest = preview.journeyFixture;
      assert.equal(manifest.policy, 'synthetic-journey-fixtures-v1');
      assert.equal(manifest.kind, 'public-search-v1');
      assert.equal(manifest.tenantSlug, company);
      assert.equal(Object.hasOwn(manifest, 'enquiries'), false);
      assertFrozen(manifest);
      const stock = manifest.public;
      assert.equal(stock.total, 32);
      assert.equal(stock.monthlyTotal, 26);
      assert.equal(stock.listingIds.length, 31);
      assert.equal(new Set(stock.listingIds).size, 31);
      const pages = [];
      for (const offset of [0, 12, 24]) {
        const page = await api.searchSyntheticReferencePropertiesV3({ limit: 12, offset });
        assert.equal(page.total, stock.total);
        assert.equal(page.offset, offset);
        assert.equal(page.items.length, offset === 24 ? 8 : 12);
        assert.equal(page.hasMore, offset < 24);
        pages.push(page);
      }
      const all = pages.flatMap((page) => page.items);
      assert.equal(new Set(all.map((row) => row.id)).size, stock.total);
      assert.deepEqual(
        new Set(all.map((row) => row.id)),
        new Set([preview.referencePublicListingId, ...stock.listingIds]),
      );
      assert.ok(all.every((row) => !row.id.startsWith(id(foreignBase).slice(0, -3))));
      const publicText = JSON.stringify(all);
      assert.ok(!publicText.includes('PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS'));
      assert.ok(!publicText.includes(preview.bearerToken));
      assert.ok(!publicText.includes(foreignCompany));
      const monthly = { purpose: 'rent', period: 'month' };
      const ordered = await api.searchSyntheticReferencePropertiesV3({
        ...monthly,
        sort: 'price_low',
        limit: 100,
      });
      assert.equal(ordered.total, stock.monthlyTotal);
      assert.ok(ordered.items.every((row) => row.rentPeriod === 'month' && row.purpose === 'rent'));
      assert.ok(
        ordered.items.every(
          (row, index) => index === 0 || ordered.items[index - 1].amountMinor <= row.amountMinor,
        ),
      );
      assert.equal(ordered.items[0].id, stock.monthly.below);
      for (const [name, minor] of [
        ['below', 1999999],
        ['equal', 2000000],
        ['above', 2000001],
      ]) {
        const row = await api.searchSyntheticReferencePropertiesV3({
          id: stock.monthly[name],
          limit: 1,
        });
        assert.equal(row.items[0].amountMinor, minor);
        const strict = await api.searchSyntheticReferencePropertiesV3({
          ...monthly,
          id: stock.monthly[name],
          min: '20000.00',
          minMode: 'over',
          max: '20000.01',
        });
        assert.equal(strict.total, name === 'above' ? 1 : 0);
      }
      assertIds(
        await api.searchSyntheticReferencePropertiesV3({
          ...monthly,
          id: stock.monthly.equal,
          min: '20000.00',
          max: '20000.00',
        }),
        [stock.monthly.equal],
      );
      const equalExclusive = await api.searchSyntheticReferencePropertiesV3({
        ...monthly,
        min: '20000.00',
        minMode: 'over',
        max: '20000.00',
      });
      assert.equal(equalExclusive.total, 0);
      assert.deepEqual(equalExclusive.items, []);
      const bedrooms = stock.monthly.bedrooms;
      assertIds(
        await api.searchSyntheticReferencePropertiesV3({
          ...monthly,
          beds: '7',
          bedsMode: 'at_least',
        }),
        [bedrooms.seven, bedrooms.eight, bedrooms.nine, bedrooms.ten],
      );
      for (const [key, beds] of [
        ['six', '6'],
        ['seven', '7'],
        ['eight', '8'],
        ['nine', '9'],
        ['ten', '10'],
      ])
        assertIds(await api.searchSyntheticReferencePropertiesV3({ ...monthly, beds }), [
          bedrooms[key],
        ]);
      assertIds(
        await api.searchSyntheticReferencePropertiesV3({
          ...monthly,
          beds: '7',
          bedsMode: 'at_least',
          min: '20000.00',
          minMode: 'over',
          max: '20000.02',
          privateBaths: '1',
          sharedBaths: '1',
        }),
        [bedrooms.nine],
      );
      const studio = await api.searchSyntheticReferencePropertiesV3({
        beds: '0',
        type: 'studio',
        limit: 100,
      });
      assert.ok(studio.items.some((row) => row.id === bedrooms.studio));
      assert.ok(studio.items.every((row) => row.bedrooms === 0));
      assert.ok(!studio.items.some((row) => row.id === bedrooms.land));
      const mobileConfig = {
        mode: 'synthetic-reference-public-v1',
        tenantSlug: company,
        apiOrigin: preview.origin,
        allowLoopbackHttp: true,
      };
      let online = true;
      let now = 1000;
      const mobile = createMobileReferenceReadSession(mobileConfig, {
        now: () => now,
        maxAgeMs: 1000,
        fetch: (url, init) =>
          online ? fetch(url, init) : Promise.reject(new TypeError('Synthetic connection loss')),
      });
      const form = { ...emptyMobileReferenceFilters, ...monthly, type: 'studio', beds: '0' };
      const exactStudio = prepareMobileReferenceSearch(form);
      assert.equal(exactStudio.status, 'ready');
      const filtered = await mobile.read(exactStudio.input);
      assert.equal(filtered.freshness, 'current');
      assert.ok(filtered.items.some(({ property }) => property.id === bedrooms.studio));
      assert.ok(filtered.items.every(({ property }) => property.bedrooms === 0));

      const groupedPrice = prepareMobileReferenceSearch({
        ...emptyMobileReferenceFilters,
        ...monthly,
        beds: '7',
        bedsMode: 'at_least',
        min: '20000.00',
        minMode: 'over',
        max: '20000.02',
        privateBaths: '1',
        sharedBaths: '1',
      });
      assert.equal(groupedPrice.status, 'ready');
      const exact = await mobile.read(groupedPrice.input);
      assert.equal(exact.freshness, 'current');
      assert.deepEqual(
        exact.items.map(({ property }) => property.id),
        [bedrooms.nine],
      );
      online = false;
      const previous = await mobile.read(groupedPrice.input);
      assert.equal(previous.freshness, 'previous');
      assert.deepEqual(previous.items, exact.items);
      now = 2000;
      assert.equal((await mobile.read(groupedPrice.input)).status, 'error');
      assert.equal((await mobile.read(exactStudio.input)).status, 'error');

      const declared = await api.searchSyntheticReferencePropertiesV3({
        beds: '0',
        bedsMode: 'at_least',
        limit: 100,
      });
      assert.equal(declared.total, stock.total - 1);
      assert.ok(!declared.items.some((row) => row.id === bedrooms.land));
      const land = await api.searchSyntheticReferencePropertiesV3({ id: bedrooms.land, limit: 1 });
      assert.equal(land.items[0].bedrooms, null);
      assertIds(
        await api.searchSyntheticReferencePropertiesV3({
          purpose: 'sale',
          min: '10000000.00',
          minMode: 'over',
          max: '10000000.01',
        }),
        [stock.sale.above],
      );
      assertIds(
        await api.searchSyntheticReferencePropertiesV3({
          purpose: 'sale',
          min: '10000000.00',
          max: '10000000.00',
        }),
        [stock.sale.equal],
      );
      for (const period of ['day', 'week', 'year'])
        assertIds(await api.searchSyntheticReferencePropertiesV3({ purpose: 'rent', period }), [
          stock.periods[period],
        ]);
      const outside = stock.referenceOutsideFirstPage;
      assert.equal(outside.listingId, stock.monthly.below);
      assert.ok(!pages[0].items.some((row) => row.id === outside.listingId));
      assert.ok(
        !pages[0].items.some(
          (row) => row.reference.attributes.location.county.id === outside.countyId,
        ),
      );
      const choices = await api.getSyntheticReferenceSearchOptions();
      assert.ok(choices.countyId.some((choice) => choice.id === outside.countyId));
      assertIds(
        await api.searchSyntheticReferencePropertiesV3({ countyId: outside.countyId, limit: 12 }),
        [outside.listingId],
      );
      const later = pages[2].items.find(
        (row) => !pages[0].items.some((first) => first.id === row.id),
      );
      assertIds(await api.searchSyntheticReferencePropertiesV3({ id: later.id, limit: 1 }), [
        later.id,
      ]);
      assert.equal(
        (await api.searchSyntheticReferencePropertiesV3({ id: id(foreignBase), limit: 1 })).total,
        0,
      );
      const outOfRange = await api.searchSyntheticReferencePropertiesV3({ limit: 12, offset: 36 });
      assert.equal(outOfRange.total, stock.total);
      assert.equal(outOfRange.hasMore, false);
      assert.deepEqual(outOfRange.items, []);
    } finally {
      await preview.close();
    }
  }
});

test('signed enquiry journey stock pages 60/53 rows and finds old follow-ups beyond the first 50 under current assignment', async () => {
  for (const [company, foreignCompany] of [
    ['realtime-estates', 'sample-homes'],
    ['sample-homes', 'realtime-estates'],
  ]) {
    const preview = await startStaffPreview({
      port: 0,
      tenantSlug: company,
      ...enquiryModes,
      journeyFixture: 'enquiry-queue-v1',
    });
    try {
      const api = client(preview),
        manifest = preview.journeyFixture;
      assert.equal(manifest.policy, 'synthetic-journey-fixtures-v1');
      assert.equal(manifest.kind, 'enquiry-queue-v1');
      assert.equal(manifest.tenantSlug, company);
      assert.equal(Object.hasOwn(manifest, 'public'), false);
      assertFrozen(manifest);
      const stock = manifest.enquiries;
      assert.equal(stock.adminTotal, 60);
      assert.equal(stock.agentTotal, 53);
      assert.equal(stock.extraIds.length, 55);
      assert.equal(stock.oldOverdue, preview.enquiryFixtures.contacted);
      assert.equal(Date.parse(stock.nextMidnightAt) - Date.parse(stock.todayDueAt), 1);
      assert.ok(inNairobiDay(stock.todayDueAt, stock.seededAt));
      const allByRole = {};
      for (const [role, total] of [
        ['admin', stock.adminTotal],
        ['agent', stock.agentTotal],
      ]) {
        const options = { bearerToken: preview.enquiryStaff[role].bearerToken };
        const first = await api.listStaffEnquiriesV3({ limit: 50, filter: 'all' }, options);
        assert.equal(first.items.length, 50);
        assert.equal(first.hasMore, true);
        assert.equal(first.nextAfter, first.items.at(-1).id);
        assert.ok(!first.items.some((row) => row.id === stock.oldOverdue));
        const second = await api.listStaffEnquiriesV3(
          { limit: 50, filter: 'all', after: first.nextAfter },
          options,
        );
        assert.equal(second.items.length, total - 50);
        assert.equal(second.hasMore, false);
        assert.equal(second.nextAfter, null);
        allByRole[role] = [...first.items, ...second.items];
        assert.equal(new Set(allByRole[role].map((row) => row.id)).size, total);
        assert.ok(allByRole[role].some((row) => row.id === stock.oldOverdue));
        assert.ok(
          allByRole[role].every(
            (row) =>
              !Object.hasOwn(row, 'email') &&
              !Object.hasOwn(row, 'message') &&
              !Object.hasOwn(row, 'phone'),
          ),
        );
        const overdue = await api.listStaffEnquiriesV3({ limit: 100, filter: 'overdue' }, options);
        assert.ok(overdue.items.some((row) => row.id === stock.oldOverdue));
        assert.ok(
          overdue.items.every((row) => Date.parse(row.nextActionAt) < Date.parse(overdue.asOf)),
        );
        const today = await api.listStaffEnquiriesV3({ limit: 100, filter: 'today' }, options);
        assert.equal(
          today.items.some((row) => row.id === stock.today),
          inNairobiDay(stock.todayDueAt, today.asOf),
        );
        assert.equal(
          today.items.some((row) => row.id === stock.peerToday),
          role === 'admin' && inNairobiDay(stock.todayDueAt, today.asOf),
        );
        assert.ok(today.items.every((row) => inNairobiDay(row.nextActionAt, today.asOf)));
        for (const filtered of [
          overdue,
          today,
          await api.listStaffEnquiriesV3({ limit: 100, filter: 'open' }, options),
        ])
          assert.ok(
            filtered.items.every((row) => row.id !== stock.closedWon && row.id !== stock.spam),
          );
      }
      assert.deepEqual(
        new Set(allByRole.admin.map((row) => row.id)),
        new Set([...stock.extraIds, ...Object.values(preview.enquiryFixtures)]),
      );
      assert.ok(
        allByRole.agent.every((row) => row.assignedAgentId === preview.enquiryStaff.agent.actorId),
      );
      const adminOptions = { bearerToken: preview.enquiryStaff.admin.bearerToken };
      const agentOptions = { bearerToken: preview.enquiryStaff.agent.bearerToken };
      for (const [enquiryId, status, version] of [
        [stock.closedWon, 'closed_won', '5'],
        [stock.spam, 'spam', '4'],
      ]) {
        const detail = await api.getStaffEnquiryV2(enquiryId, agentOptions);
        assert.equal(detail.status, status);
        assert.equal(detail.version, version);
        assert.equal(detail.nextActionAt, null);
      }
      assert.equal((await fetch(preview.origin + '/v3/staff/enquiries')).status, 401);
      assert.equal(
        (await signed(preview, '/v3/staff/enquiries?after=' + stock.peerToday, 'agent')).status,
        404,
      );
      assert.equal(
        (
          await signed(
            preview,
            '/v3/staff/enquiries?after=' + ENQUIRY_PREVIEW_FIXTURES[foreignCompany].general,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await signed(
            preview,
            '/v2/staff/enquiries/' + ENQUIRY_PREVIEW_FIXTURES[foreignCompany].general,
          )
        ).status,
        404,
      );
      for (const credential of Object.values(preview.enquiryStaff))
        assert.ok(!JSON.stringify(manifest).includes(credential.bearerToken));
      const assignees = await api.listEnquiryAssigneesV2(adminOptions);
      const peer = assignees.items.find(
        (row) => row.role === 'agent' && row.userId !== preview.enquiryStaff.agent.actorId,
      );
      const before = await api.getStaffEnquiryV2(stock.today, agentOptions);
      const reassigned = await api.applyEnquiryOperationV2(
        stock.today,
        {
          operationId: randomUUID(),
          kind: 'assign',
          expectedVersion: before.version,
          assignedAgentId: peer.userId,
          status: null,
          nextActionAt: null,
          reason: null,
        },
        adminOptions,
      );
      assert.equal(reassigned.outcome, 'applied');
      await assert.rejects(
        () => api.getStaffEnquiryV2(stock.today, agentOptions),
        (error) => error.status === 404,
      );
      assert.equal(
        (await signed(preview, '/v3/staff/enquiries?after=' + stock.today, 'agent')).status,
        404,
      );
      const currentAgent = await api.listStaffEnquiriesV3(
        { limit: 100, filter: 'all' },
        agentOptions,
      );
      assert.equal(currentAgent.items.length, stock.agentTotal - 1);
      assert.ok(!currentAgent.items.some((row) => row.id === stock.today));
      assert.equal(
        (await api.getStaffEnquiryV2(stock.today, adminOptions)).assignedAgentId,
        peer.userId,
      );
    } finally {
      await preview.close();
    }
  }
});
