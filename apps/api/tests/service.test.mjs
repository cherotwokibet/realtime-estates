import test from 'node:test';
import assert from 'node:assert/strict';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { PGlite } from '@electric-sql/pglite';
import { createApiService, createLocalEnquiryLimiter } from '../dist/service.js';
import {
  PostgresTransactionDatabase,
  assertSafeRuntimeConnection,
  DatabaseSafetyError,
} from '../dist/database.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHER_ADMIN = id(20);
const PUBLIC = id(100),
  PEER_LISTING = id(101),
  OTHER_PUBLIC = id(200),
  CREATED = id(110);
const content = {
  title: 'Synthetic API studio',
  description: 'Synthetic service integration listing, never production stock.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2_000_000,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic locality',
  publicPrecision: 'area',
  latitude: -1.3,
  longitude: 36.7,
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
};

async function bootstrapAs(db, tenant, actor, operation) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)`,
      [tenant, actor],
    );
    const result = await operation(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function fixture(extraSearch = 0) {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-a','Synthetic A'),($2,'synthetic-b','Synthetic B')`,
    [T, OTHER],
  );
  for (const [tenant, user, role] of [
    [T, ADMIN, 'admin'],
    [T, AGENT, 'agent'],
    [T, PEER, 'agent'],
    [T, CUSTOMER, 'customer'],
    [OTHER, OTHER_ADMIN, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenant,
      user,
      role,
    ]);
  // Reuse existing search records so room boundaries preserve the 102-record price/paging fixture.
  const groupedBedrooms = new Map(
    extraSearch === 101
      ? [
          [id(5095), 6],
          [id(5096), 7],
          [id(5097), 8],
          [id(5098), 9],
          [id(5099), 10],
          [id(5100), null],
          [OTHER_PUBLIC, 7],
        ]
      : [],
  );
  for (const [tenant, listing, agent, admin] of [
    [T, PUBLIC, AGENT, ADMIN],
    [OTHER, OTHER_PUBLIC, OTHER_ADMIN, OTHER_ADMIN],
    ...Array.from({ length: extraSearch }, (_, i) => [T, id(5000 + i), AGENT, ADMIN]),
  ]) {
    const searchIndex = Number(listing.slice(-12)) - 5000;
    const bedrooms = groupedBedrooms.get(listing);
    await bootstrapAs(db, tenant, agent, async (query) => {
      await seedGuardedListingDraft(query, {
        listingId: listing,
        slug: `synthetic-${listing.slice(searchIndex >= 0 ? -12 : -3)}`,
        content: {
          ...content,
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
          ...(searchIndex >= 0
            ? {
                title: 'Synthetic extra',
                amountMinor: 2000001 + searchIndex,
                pricing: { declaration: 'complete', charges: [] },
                location: {
                  county: 'Synthetic County',
                  town: 'Synthetic Town',
                  area: 'Synthetic Area',
                },
              }
            : {}),
          ...(bedrooms !== undefined
            ? {
                propertyType: bedrooms === null ? 'land' : 'apartment',
                bedrooms,
                privateBathrooms:
                  bedrooms === null || bedrooms === 10 ? null : content.privateBathrooms,
                sharedBathrooms: bedrooms === 9 ? 2 : bedrooms === 10 ? 1 : null,
              }
            : {}),
        },
        actorId: agent,
      });
      await query.query("SELECT app_api.confirm_availability($1,1,'available')", [listing]);
    });
    // Privileged SQL-only relational provenance; no image bytes or processor run.
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, {
        tenantId: tenant,
        listingId: listing,
        mediaId: id(Number(listing.slice(-12)) * 10 + position),
        position,
      });
    await bootstrapAs(db, tenant, agent, (query) =>
      query.query('SELECT app_api.submit_revision($1,1,2)', [listing]),
    );
    await bootstrapAs(db, tenant, admin, (query) =>
      query.query('SELECT app_api.decide_revision($1,1,3,true)', [listing]),
    );
  }
  await bootstrapAs(db, T, PEER, (query) =>
    query.query("SELECT app_api.create_listing($1,'synthetic-peer')", [PEER_LISTING]),
  );
  await assert.rejects(
    () => assertSafeRuntimeConnection({ query: (sql, args) => db.query(sql, args) }),
    DatabaseSafetyError,
  );
  await db.exec(
    'CREATE ROLE api_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_test_login; SET SESSION AUTHORIZATION api_test_login;',
  );
  // PGlite is one connection: queue checkouts to model a pool without interleaving transactions.
  let tail = Promise.resolve();
  let destroyed = 0;
  const pool = {
    async connect() {
      let unlock;
      const next = new Promise((resolve) => {
        unlock = resolve;
      });
      const previous = tail;
      tail = next;
      await previous;
      return {
        query: (sql, args) => db.query(sql, args ? [...args] : []),
        release(destroy) {
          if (destroy) destroyed++;
          unlock();
        },
      };
    },
  };
  const database = new PostgresTransactionDatabase(pool);
  await database.checkConnection();
  const subjects = {
    'Bearer test-agent': AGENT,
    'Bearer test-peer': PEER,
    'Bearer test-admin': ADMIN,
    'Bearer test-customer': CUSTOMER,
    'Bearer test-other-admin': OTHER_ADMIN,
  };
  const verifyAuthorization = async (request) => {
    const actorId = subjects[request.headers.get('authorization')];
    if (!actorId) throw new Error('Synthetic invalid token; never expose provider details.');
    return { actorId };
  };
  const service = createApiService({
    database,
    tenantId: T,
    privacyNoticeVersion: 'synthetic-notice-v1',
    verifyAuthorization,
    limiter: createLocalEnquiryLimiter({ limit: 100 }),
    clientKey: () => 'trusted-synthetic-socket',
  });
  const other = createApiService({
    database,
    tenantId: OTHER,
    privacyNoticeVersion: 'synthetic-notice-v1',
    verifyAuthorization,
    limiter: createLocalEnquiryLimiter({ limit: 100 }),
  });
  return { db, database, service, other, getDestroyed: () => destroyed };
}
function request(path, { method = 'GET', actor, body, headers = {} } = {}) {
  return new Request(`https://synthetic.invalid${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(actor ? { Authorization: `Bearer test-${actor}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const enquiry = {
  listingId: PUBLIC,
  name: 'Synthetic Prospect',
  phone: '0700000000',
  message: 'Synthetic enquiry for an integration test.',
  origin: 'web',
  noticeVersion: 'synthetic-notice-v1',
  noticeAcknowledged: true,
};

test('tenant-wide public search pages beyond 100 approved records with exact count, filters and privacy', async () => {
  const { db, service, other } = await fixture(101);
  try {
    const read = async (query, handler = service) => {
      const res = await handler(request('/v2/properties/search?' + query));
      assert.equal(res.status, 200, await res.clone().text());
      return res.json();
    };
    const ids = [];
    for (const offset of [0, 40, 80]) {
      const body = await read('sort=title&limit=40&offset=' + offset);
      assert.equal(body.total, 102);
      assert.equal(body.policy, 'public-search-v1');
      assert.equal(body.offset, offset);
      assert.equal(body.limit, 40);
      assert.equal(body.maxOffset, 10000);
      assert.equal(body.hasMore, offset !== 80);
      ids.push(...body.items.map((row) => row.id));
      for (const row of body.items)
        for (const field of [
          'tenant_id',
          'privateAddress',
          'private_address',
          'approvedAt',
          'approved_at',
          'createdById',
          'assignedAgentId',
          'phone',
          'email',
        ])
          assert.equal(field in row, false, field);
    }
    assert.equal(ids.length, 102);
    assert.equal(new Set(ids).size, 102);
    assert.ok(!ids.includes(OTHER_PUBLIC));
    assert.deepEqual(
      ids.slice(1),
      Array.from({ length: 101 }, (_, i) => id(5000 + i)),
    );
    const empty = await read('offset=500&limit=10');
    assert.equal(empty.total, 102);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.hasMore, false);
    assert.equal((await read('limit=100')).items.length, 100);
    const low = await read('purpose=rent&period=month&sort=price_low&limit=2');
    assert.deepEqual(
      low.items.map((row) => row.id),
      [PUBLIC, id(5000)],
    );
    assert.deepEqual(
      (await read('purpose=rent&period=month&sort=price_high&limit=2')).items.map((row) => row.id),
      [id(5100), id(5099)],
    );
    assert.equal((await read('purpose=rent&period=month&max=20000.00')).total, 1);
    assert.equal((await read('purpose=rent&period=month&max=20000.01')).total, 2);
    assert.equal((await read('purpose=rent&period=month&min=20000.00')).total, 102);
    assert.equal((await read('purpose=rent&period=month&min=20000.01')).total, 101);
    assert.equal((await read('purpose=rent&period=month&min=20000.02')).total, 100);
    const exact = await read('purpose=rent&period=month&min=20000.01&max=20000.01');
    assert.equal(exact.total, 1);
    assert.equal(exact.items[0].id, id(5000));
    assert.equal(exact.items[0].amountMinor, 2000001);
    const range = await read('purpose=rent&period=month&min=20000.01&max=20000.02&sort=price_low');
    assert.equal(range.total, 2);
    assert.deepEqual(
      range.items.map((row) => row.id),
      [id(5000), id(5001)],
    );
    const over = await read('purpose=rent&period=month&min=20000.00&minMode=over&sort=price_low');
    assert.equal(over.total, 101);
    assert.equal(over.items[0].id, id(5000));
    assert.equal(over.items[0].amountMinor, 2000001);
    assert.ok(over.items.every((row) => row.amountMinor > 2000000));
    const strictRange = await read(
      'purpose=rent&period=month&min=20000.01&minMode=over&max=20000.02&sort=price_low',
    );
    assert.equal(strictRange.total, 1);
    assert.deepEqual(
      strictRange.items.map((row) => row.id),
      [id(5001)],
    );
    assert.equal(strictRange.items[0].amountMinor, 2000002);
    const strictEqual = await read(
      'purpose=rent&period=month&min=20000.01&minMode=over&max=20000.01',
    );
    assert.equal(strictEqual.total, 0);
    assert.deepEqual(strictEqual.items, []);
    assert.equal(strictEqual.hasMore, false);
    assert.equal((await read('purpose=rent&period=month&min=20000.01&minMode=over')).total, 100);
    assert.equal((await read('purpose=rent&period=month&min=20001.01&minMode=over')).total, 0);
    assert.equal(
      (await read('purpose=rent&period=month&min=20000.01&minMode=&max=20000.01')).total,
      1,
    );
    assert.equal((await read('minMode=')).total, 102);
    assert.equal((await read('purpose=rent&period=month&min=20001.02')).total, 0);
    assert.equal((await read('beds=0&privateBaths=1&location=Synthetic%20Town')).total, 95);
    const groupedIds = [];
    for (const offset of [0, 2]) {
      const grouped = await read(`beds=7&bedsMode=at_least&sort=title&limit=2&offset=${offset}`);
      assert.equal(grouped.total, 4);
      assert.equal(grouped.hasMore, offset === 0);
      assert.equal(grouped.offset, offset);
      groupedIds.push(...grouped.items.map((row) => row.id));
    }
    assert.deepEqual(groupedIds, [id(5096), id(5097), id(5098), id(5099)]);
    assert.equal(new Set(groupedIds).size, 4);
    for (const [beds, expectedId] of [
      [6, id(5095)],
      [7, id(5096)],
      [8, id(5097)],
      [9, id(5098)],
      [10, id(5099)],
    ])
      for (const mode of ['', '&bedsMode=']) {
        const exactBedrooms = await read(`beds=${beds}${mode}`);
        assert.equal(exactBedrooms.total, 1);
        assert.equal(exactBedrooms.items[0].id, expectedId);
        assert.equal(exactBedrooms.items[0].bedrooms, beds);
      }
    assert.equal((await read('beds=0')).total, 96);
    assert.equal((await read('beds=0&bedsMode=at_least')).total, 101);
    assert.equal((await read('type=land')).items[0].bedrooms, null);
    assert.equal((await read('type=land&beds=0')).total, 0);
    assert.equal((await read('type=land&beds=0&bedsMode=at_least')).total, 0);
    assert.equal((await read('beds=100&bedsMode=at_least')).total, 0);
    assert.equal((await read('bedsMode=')).total, 102);
    const groupedComposition = await read(
      'purpose=rent&period=month&type=apartment&beds=7&bedsMode=at_least&privateBaths=1&min=20000.97&minMode=over&max=20000.99&sort=price_low',
    );
    assert.equal(groupedComposition.total, 2);
    assert.deepEqual(
      groupedComposition.items.map((row) => row.id),
      [id(5097), id(5098)],
    );
    assert.equal((await read('beds=7&bedsMode=at_least&privateBaths=2')).total, 0);
    assert.equal((await read('beds=7&bedsMode=at_least&privateBaths=1')).total, 3);
    assert.equal((await read('beds=7&bedsMode=at_least&sharedBaths=1')).total, 2);
    assert.equal((await read('beds=7&bedsMode=at_least&sharedBaths=2')).total, 1);
    assert.equal((await read('sharedBaths=0')).total, 2);
    const foreignGroup = await read('beds=7&bedsMode=at_least', other);
    assert.equal(foreignGroup.total, 1);
    assert.equal(foreignGroup.items[0].id, OTHER_PUBLIC);
    for (const query of [
      'location=PRIVATE',
      'location=%25',
      'location=%5F',
      'location=%27%20OR%20true%20--',
      'purpose=sale',
      'type=villa',
      'beds=1',
      'period=day',
    ])
      assert.equal((await read(query)).total, 0, query);
    const foreign = await read('', other);
    assert.equal(foreign.total, 1);
    assert.equal(foreign.items[0].id, OTHER_PUBLIC);
    for (const query of [
      'tenantId=' + OTHER,
      'limit=1&limit=2',
      'sort=price_low',
      'offset=10001',
      'countyId=' + T,
      'purpose=rent&min=20000',
      'purpose=rent&period=month&min=20000.02&max=20000.01',
      'purpose=sale&min=1&min=2',
      'minMode=over',
      'purpose=rent&period=month&minMode=over',
      'purpose=rent&period=month&min=&minMode=over',
      'purpose=rent&period=month&max=20000&minMode=over',
      'purpose=rent&period=month&min=0&minMode=over',
      'purpose=rent&period=month&min=20000.001&minMode=over',
      'purpose=rent&period=month&min=20000&minMode=Over',
      'purpose=rent&period=month&min=20000&minMode=over&minMode=over',
      'purpose=rent&period=month&min=20000&minMode=&minMode=',
      'purpose=rent&min=20000&minMode=over',
      'period=month&min=20000&minMode=over',
      'purpose=rent&period=month&min=20000.02&minMode=over&max=20000.01',
      'bedsMode=at_least',
      'beds=&bedsMode=at_least',
      'beds=7&bedsMode=over',
      'beds=7&bedsMode=At_least',
      'beds=7&bedsMode=%20at_least',
      'beds=7&bedsMode=at_least&bedsMode=at_least',
      'beds=7&bedsMode=&bedsMode=',
      'beds=7%2B&bedsMode=at_least',
      'beds=07&bedsMode=at_least',
    ])
      assert.equal((await service(request('/v2/properties/search?' + query))).status, 400, query);
    const wrong = await service(request('/v2/properties/search', { method: 'POST', body: {} }));
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('Allow'), 'GET');
  } finally {
    await db.close();
  }
});

test('API service with actual PostgreSQL migration enforces identity, tenant isolation and persisted workflows', async (t) => {
  const fixtureData = await fixture();
  const { db, database, service, other } = fixtureData;
  try {
    await t.test(
      'public projection is tenant-scoped and excludes private address, actors and enquiry contacts',
      async () => {
        const result = await service(request('/v1/properties'));
        assert.equal(result.status, 200);
        const body = await result.json();
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].id, PUBLIC);
        assert.equal(body.items[0].amountMinor, 2_000_000);
        assert.equal(body.items[0].bedrooms, 0);
        assert.equal(body.items[0].latitude, null);
        assert.equal(body.items[0].longitude, null);
        assert.equal(body.items[0].photos.length, 4);
        for (const field of [
          'privateAddress',
          'private_address',
          'assignedAgentId',
          'createdById',
          'phone',
          'email',
        ])
          assert.equal(field in body.items[0], false, field);
        assert.equal(
          (await (await other(request('/v1/properties'))).json()).items[0].id,
          OTHER_PUBLIC,
        );
        assert.equal((await service(request('/v1/properties?limit=101'))).status, 400);
        assert.equal((await service(request('/v3/properties/search'))).status, 404);
        assert.equal((await service(request('/v3/property-reference-options'))).status, 404);
        assert.equal(
          (await service(request('/v3/properties/search', { method: 'POST', body: {} }))).status,
          404,
        );
      },
    );
    await t.test(
      'guest, invalid token and customer cannot create staff records or access staff lists',
      async () => {
        for (const [actor, status] of [
          [undefined, 401],
          ['invalid', 401],
          ['customer', 403],
        ]) {
          const result = await service(
            request('/v1/staff/listings', {
              method: 'POST',
              actor,
              body: { id: CREATED, slug: 'synthetic-created' },
            }),
          );
          assert.equal(result.status, status);
          assert.equal((await service(request('/v1/staff/listings', { actor }))).status, status);
        }
      },
    );
    await t.test(
      'body tenant/role/actor fields cannot grant access or switch company',
      async () => {
        for (const field of ['tenantId', 'role', 'actorId', 'createdById']) {
          const result = await service(
            request('/v1/staff/listings', {
              method: 'POST',
              actor: 'customer',
              body: { slug: 'forged', [field]: field === 'role' ? 'admin' : OTHER },
            }),
          );
          assert.equal(result.status, 400);
        }
        assert.equal(
          (await service(request('/v1/staff/listings', { actor: 'other-admin' }))).status,
          403,
        );
      },
    );
    await t.test(
      'agent creates assigned-to-self and cannot assign another agent; admin may assign',
      async () => {
        assert.equal(
          (
            await service(
              request('/v1/staff/listings', {
                method: 'POST',
                actor: 'agent',
                body: { id: id(122), slug: 'synthetic-created' },
              }),
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await service(
              request('/v1/staff/listings', {
                method: 'POST',
                actor: 'agent',
                body: { slug: 'forbidden-assignment', assignedAgentId: PEER },
              }),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await service(
              request('/v1/staff/listings', {
                method: 'POST',
                actor: 'admin',
                body: { id: id(111), slug: 'admin-assigned', assignedAgentId: PEER },
              }),
            )
          ).status,
          201,
        );
        const own = (
          await (await service(request('/v1/staff/listings', { actor: 'agent' }))).json()
        ).items;
        assert.ok(
          own.some(
            (item) =>
              item.id === id(122) && item.createdById === AGENT && item.assignedAgentId === AGENT,
          ),
        );
        assert.equal(
          own.some((item) => item.id === PEER_LISTING),
          false,
        );
        const peer = (
          await (await service(request('/v1/staff/listings', { actor: 'peer' }))).json()
        ).items;
        assert.equal(
          peer.some((item) => item.id === id(122)),
          false,
        );
      },
    );
    await t.test(
      'persisted drafts require numeric versions, cannot cross assignment/company, and do not become public',
      async () => {
        const route = `/v1/staff/listings/${CREATED}/drafts/1`;
        await bootstrapAs(db, T, AGENT, (query) =>
          seedGuardedListingDraft(query, {
            listingId: CREATED,
            slug: 'synthetic-editable-created',
            content: {
              ...content,
              pricing: { declaration: 'not_declared', charges: [] },
              location: { county: null, town: null, area: null },
            },
            actorId: AGENT,
          }),
        );
        const result = await service(
          request(route, { method: 'PUT', actor: 'agent', body: { expectedVersion: 0, content } }),
        );
        assert.equal(result.status, 400);
        assert.equal(
          (await service(request(route, { method: 'PUT', actor: 'agent', body: { content } })))
            .status,
          400,
        );
        assert.equal(
          (
            await service(
              request(route, {
                method: 'PUT',
                actor: 'agent',
                body: { expectedVersion: 1, content },
              }),
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await service(
              request(route, {
                method: 'PUT',
                actor: 'peer',
                body: { expectedVersion: 2, content },
              }),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await other(
              request(route, {
                method: 'PUT',
                actor: 'other-admin',
                body: { expectedVersion: 2, content },
              }),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await service(
              request(route, {
                method: 'PUT',
                actor: 'agent',
                body: { expectedVersion: 2, content: { ...content, tenantId: OTHER } },
              }),
            )
          ).status,
          400,
        );
        assert.equal((await (await service(request('/v1/properties'))).json()).items.length, 1);
      },
    );
    await t.test(
      'HTTP submit cannot bypass four accepted images or expose database diagnostics',
      async () => {
        const result = await service(
          request(`/v1/staff/listings/${CREATED}/drafts/1/submit`, {
            method: 'POST',
            actor: 'agent',
            body: { expectedVersion: 2 },
          }),
        );
        assert.equal(result.status, 422);
        const raw = await result.text();
        assert.equal(raw.includes('app_private'), false);
        assert.equal(raw.includes('Require 4'), false);
        assert.equal(
          (
            await service(
              request(`/v1/staff/listings/${CREATED}/drafts/1/submit`, {
                method: 'POST',
                actor: 'customer',
                body: { expectedVersion: 2 },
              }),
            )
          ).status,
          403,
        );
      },
    );
    const v2Id = id(120),
      v2Route = `/v2/staff/listings/${v2Id}/drafts/1`;
    const pricing = {
      declaration: 'complete',
      charges: [
        {
          id: 'service',
          name: 'Service charge',
          amountStatus: 'known',
          amountMinor: 100_000,
          timing: 'per_rental_period',
          classification: 'fee',
          mandatory: true,
        },
        {
          id: 'deposit',
          name: 'Refundable deposit',
          amountStatus: 'known',
          amountMinor: 2_000_000,
          timing: 'one_off',
          classification: 'refundable_deposit',
          mandatory: true,
        },
        {
          id: 'parking',
          name: 'Optional parking',
          amountStatus: 'quote_required',
          amountMinor: null,
          timing: 'per_rental_period',
          classification: 'fee',
          mandatory: false,
        },
      ],
    };
    const location = { county: 'Nairobi', town: null, area: 'Synthetic area' };
    const v2Content = { ...content, pricing, location };
    await t.test(
      'v2 public projection preserves explicit unknowns and v1 stays unchanged',
      async () => {
        const v2 = await service(request('/v2/properties?limit=1'));
        assert.equal(v2.status, 200);
        const body = await v2.json();
        assert.equal(body.limit, 1);
        assert.equal(body.items[0].id, PUBLIC);
        assert.deepEqual(body.items[0].pricing, { declaration: 'not_declared', charges: [] });
        assert.deepEqual(body.items[0].location, { county: null, town: null, area: null });
        const v1 = (await (await service(request('/v1/properties'))).json()).items[0];
        assert.equal('pricing' in v1, false);
        assert.equal('location' in v1, false);
        const { pricing: ignoredPricing, location: ignoredLocation, ...unchanged } = body.items[0];
        assert.deepEqual(unchanged, v1);
        assert.equal((await service(request('/v2/properties?limit=101'))).status, 400);
        const wrongMethod = await service(request('/v2/properties', { method: 'DELETE' }));
        assert.equal(wrongMethod.status, 405);
        assert.equal(wrongMethod.headers.get('allow'), 'GET');
      },
    );
    await t.test(
      'v2 initialized private draft reads preserve fees and location while ordinary saves refuse allocation',
      async () => {
        await bootstrapAs(db, T, AGENT, (query) =>
          seedGuardedListingDraft(query, {
            listingId: v2Id,
            slug: 'synthetic-v2',
            content: v2Content,
            actorId: AGENT,
          }),
        );

        const saved = await service(
          request(v2Route, {
            method: 'PUT',
            actor: 'agent',
            body: { expectedVersion: 0, content: v2Content },
          }),
        );
        assert.equal(saved.status, 400);
        const loaded = await service(request(v2Route, { actor: 'agent' }));
        assert.equal(loaded.status, 200);
        const body = await loaded.json();
        assert.equal(body.version, '2');
        assert.equal(body.state, 'draft');
        assert.equal(body.revision, 1);
        assert.deepEqual(body.content.pricing, pricing);
        assert.deepEqual(body.content.location, location);
        assert.equal(body.content.amountMinor, content.amountMinor);
        assert.equal(body.content.privateAddress, content.privateAddress);
        assert.equal(
          (await (await service(request('/v2/properties'))).json()).items.some(
            (item) => item.id === v2Id,
          ),
          false,
        );
      },
    );
    await t.test(
      'v2 private draft reads enforce identity, assignment and company scope',
      async () => {
        for (const [actor, status] of [
          [undefined, 401],
          ['invalid', 401],
          ['customer', 403],
          ['peer', 404],
          ['other-admin', 403],
        ]) {
          assert.equal((await service(request(v2Route, { actor }))).status, status, actor);
        }
        assert.equal((await service(request(v2Route, { actor: 'admin' }))).status, 200);
        assert.equal((await other(request(v2Route, { actor: 'other-admin' }))).status, 404);
        assert.equal(
          (
            await service(
              request(`/v2/staff/listings/${v2Id}/drafts/2147483648`, { actor: 'agent' }),
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'v2 rejects ambiguous, noncanonical and unsafe disclosure before any write',
      async () => {
        const badContents = [
          { ...v2Content, pricing: undefined },
          { ...v2Content, location: undefined },
          { ...v2Content, tenantId: OTHER },
          { ...v2Content, pricing: { ...pricing, guessedTotal: 10 } },
          { ...v2Content, location: { ...location, town: ' ' } },
          {
            ...v2Content,
            pricing: { ...pricing, charges: [pricing.charges[0], pricing.charges[0]] },
          },
          {
            ...v2Content,
            pricing: {
              declaration: 'complete',
              charges: [{ ...pricing.charges[0], amountMinor: Number.MAX_SAFE_INTEGER }],
            },
          },
          {
            ...v2Content,
            pricing: {
              declaration: 'complete',
              charges: [{ ...pricing.charges[2], amountMinor: 1 }],
            },
          },
          { ...v2Content, purpose: 'sale', rentPeriod: null },
        ];
        for (const badContent of badContents) {
          const result = await service(
            request(v2Route, {
              method: 'PUT',
              actor: 'agent',
              body: { expectedVersion: 2, content: badContent },
            }),
          );
          assert.equal(result.status, 400, JSON.stringify(badContent));
          assert.equal((await result.text()).includes('app_private'), false);
        }
        assert.equal(
          (await (await service(request(v2Route, { actor: 'agent' }))).json()).version,
          '2',
        );
      },
    );
    await t.test(
      'v2 uses optimistic locking and cannot cross assignment or company on writes',
      async () => {
        const body = { expectedVersion: 2, content: v2Content };
        assert.equal(
          (await service(request(v2Route, { method: 'PUT', actor: 'peer', body }))).status,
          404,
        );
        assert.equal(
          (await other(request(v2Route, { method: 'PUT', actor: 'other-admin', body }))).status,
          404,
        );
        assert.equal(
          (
            await service(
              request(v2Route, {
                method: 'PUT',
                actor: 'agent',
                body: { ...body, expectedVersion: 1 },
              }),
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await service(
              request(v2Route, {
                method: 'PUT',
                actor: 'agent',
                body: { ...body, expectedVersion: '2' },
              }),
            )
          ).status,
          400,
        );
        assert.equal(
          (await service(request(v2Route, { method: 'PUT', actor: 'agent', body }))).status,
          200,
        );
        assert.equal(
          (await service(request(v2Route, { method: 'PUT', actor: 'agent', body }))).status,
          409,
        );
        assert.equal(
          (await (await service(request(v2Route, { actor: 'agent' }))).json()).version,
          '3',
        );
      },
    );
    await t.test(
      'v2 atomic rent-to-sale edit replaces incompatible fees without an intermediate state',
      async () => {
        const sale = {
          ...v2Content,
          purpose: 'sale',
          rentPeriod: null,
          pricing: {
            declaration: 'incomplete',
            charges: [
              {
                ...pricing.charges[0],
                amountStatus: 'quote_required',
                amountMinor: null,
                timing: 'one_off',
              },
            ],
          },
        };
        const saved = await service(
          request(v2Route, {
            method: 'PUT',
            actor: 'agent',
            body: { expectedVersion: 3, content: sale },
          }),
        );
        assert.equal(saved.status, 200);
        assert.deepEqual(await saved.json(), { version: '4' });
        const loaded = (await (await service(request(v2Route, { actor: 'agent' }))).json()).content;
        assert.equal(loaded.purpose, 'sale');
        assert.equal(loaded.rentPeriod, null);
        assert.deepEqual(loaded.pricing, sale.pricing);
      },
    );
    await t.test(
      'v2 submit retains media gate and leaves a failed submission editable',
      async () => {
        const result = await service(
          request(`${v2Route}/submit`, {
            method: 'POST',
            actor: 'agent',
            body: { expectedVersion: 4 },
          }),
        );
        assert.equal(result.status, 422);
        assert.equal((await result.text()).includes('Require 4'), false);
        const loaded = await (await service(request(v2Route, { actor: 'agent' }))).json();
        assert.equal(loaded.state, 'draft');
        assert.equal(loaded.version, '4');
        const wrongMethod = await service(request(v2Route, { method: 'POST', actor: 'agent' }));
        assert.equal(wrongMethod.status, 405);
        assert.equal(wrongMethod.headers.get('allow'), 'GET, PUT');
      },
    );
    await t.test(
      'bounded v2 body accepts valid Unicode field maxima and rejects oversized payloads',
      async () => {
        const largeId = id(121),
          route = `/v2/staff/listings/${largeId}/drafts/1`;
        await bootstrapAs(db, T, AGENT, (query) =>
          seedGuardedListingDraft(query, {
            listingId: largeId,
            slug: 'synthetic-unicode',
            content: v2Content,
            actorId: AGENT,
          }),
        );
        const largeContent = {
          ...v2Content,
          description: '🏡'.repeat(10_000),
          pricing: {
            declaration: 'complete',
            charges: Array.from({ length: 32 }, (_, index) => ({
              id: String(index).padStart(2, '0') + '🏡'.repeat(62),
              name: '🏡'.repeat(160),
              amountStatus: 'known',
              amountMinor: 1,
              timing: 'one_off',
              classification: 'fee',
              mandatory: true,
            })),
          },
        };

        const body = { expectedVersion: 2, content: largeContent };
        assert.ok(Buffer.byteLength(JSON.stringify(body)) > 64 * 1024);
        assert.ok(Buffer.byteLength(JSON.stringify(body)) < 128 * 1024);
        const saved = await service(request(route, { method: 'PUT', actor: 'agent', body }));
        assert.equal(saved.status, 200);
        const loaded = (await (await service(request(route, { actor: 'agent' }))).json()).content;
        assert.deepEqual(loaded.pricing, largeContent.pricing);
        assert.equal(loaded.description, largeContent.description);
        const oversized = {
          expectedVersion: 2,
          content: { ...largeContent, description: 'x'.repeat(128 * 1024) },
        };
        assert.equal(
          (await service(request(route, { method: 'PUT', actor: 'agent', body: oversized })))
            .status,
          413,
        );
        assert.equal(
          (
            await service(
              request(`/v1/staff/listings/${largeId}/drafts/1`, {
                method: 'PUT',
                actor: 'agent',
                body: {
                  expectedVersion: 2,
                  content: { ...content, description: 'x'.repeat(64 * 1024) },
                },
              }),
            )
          ).status,
          413,
        );
        assert.equal(
          (await (await service(request(route, { actor: 'agent' }))).json()).version,
          '3',
        );
      },
    );
    await t.test(
      'v2 rejects fractional money tokens before JSON rounding can turn them into safe integers',
      async () => {
        const wire = JSON.stringify({
          expectedVersion: 4,
          content: {
            ...v2Content,
            pricing: {
              declaration: 'complete',
              charges: [
                {
                  ...pricing.charges[0],
                  amountMinor: Number.MAX_SAFE_INTEGER,
                  timing: 'one_off',
                  mandatory: false,
                },
              ],
            },
          },
        });
        const token = `"amountMinor":${Number.MAX_SAFE_INTEGER}`;
        for (const replacement of [
          `"amountMinor":${Number.MAX_SAFE_INTEGER}.1`,
          `"amountMino\\u0072":${Number.MAX_SAFE_INTEGER}.1`,
          '"amountMinor":9e0',
        ]) {
          const result = await service(
            new Request(`https://synthetic.invalid${v2Route}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-agent' },
              body: wire.replace(token, replacement),
            }),
          );
          assert.equal(result.status, 400, replacement);
          assert.equal((await result.json()).error.code, 'INVALID_JSON');
        }
        assert.equal(
          (await (await service(request(v2Route, { actor: 'agent' }))).json()).version,
          '4',
        );
        const valid = await service(
          new Request(`https://synthetic.invalid${v2Route}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-agent' },
            body: wire,
          }),
        );
        assert.equal(valid.status, 200);
        assert.deepEqual(await valid.json(), { version: '5' });
      },
    );
    await t.test(
      'guest enquiry normalizes phone and retry creates exactly one durable record',
      async () => {
        const key = id(300);
        const headers = { 'Idempotency-Key': key };
        const first = await service(
          request('/v1/enquiries', { method: 'POST', body: enquiry, headers }),
        );
        const retry = await service(
          request('/v1/enquiries', {
            method: 'POST',
            body: { ...enquiry, phone: '+254700000000' },
            headers,
          }),
        );
        assert.equal(first.status, 201);
        assert.equal(retry.status, 201);
        const firstId = (await first.json()).id;
        assert.equal((await retry.json()).id, firstId);
        const rows = (
          await (await service(request('/v1/staff/enquiries', { actor: 'admin' }))).json()
        ).items;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].phone, '+254700000000');
        assert.equal(
          (await (await service(request('/v1/staff/enquiries', { actor: 'agent' }))).json()).items
            .length,
          0,
        );
        await database.transaction(
          { tenantId: T, actorId: ADMIN, correlationId: 'synthetic-assign' },
          (query) => query.query('SELECT app_api.assign_enquiry($1,1,$2)', [firstId, AGENT]),
        );
        assert.equal(
          (await (await service(request('/v1/staff/enquiries', { actor: 'agent' }))).json()).items
            .length,
          1,
        );
        assert.equal(
          (await (await service(request('/v1/staff/enquiries', { actor: 'peer' }))).json()).items
            .length,
          0,
        );
      },
    );
    await t.test(
      'same idempotency key with changed message conflicts and cannot overwrite original',
      async () => {
        const result = await service(
          request('/v1/enquiries', {
            method: 'POST',
            body: { ...enquiry, message: 'A changed synthetic message.' },
            headers: { 'Idempotency-Key': id(300) },
          }),
        );
        assert.equal(result.status, 409);
        const rows = (
          await (await service(request('/v1/staff/enquiries', { actor: 'admin' }))).json()
        ).items;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].message, enquiry.message);
      },
    );
    await t.test(
      'invalid phone, blank fields, spoofed tenant and non-public listing references are rejected',
      async () => {
        for (const body of [
          { ...enquiry, phone: '+255700000000' },
          { ...enquiry, name: ' ' },
          { ...enquiry, message: ' ' },
          { ...enquiry, tenantId: OTHER },
          { ...enquiry, phone: null, email: null },
        ]) {
          assert.equal(
            (
              await service(
                request('/v1/enquiries', {
                  method: 'POST',
                  body,
                  headers: { 'Idempotency-Key': id(301) },
                }),
              )
            ).status,
            400,
          );
        }
        for (const listingId of [OTHER_PUBLIC, CREATED])
          assert.equal(
            (
              await service(
                request('/v1/enquiries', {
                  method: 'POST',
                  body: { ...enquiry, listingId },
                  headers: { 'Idempotency-Key': id(301) },
                }),
              )
            ).status,
            404,
          );
        assert.equal(
          (await service(request('/v1/enquiries', { method: 'POST', body: enquiry }))).status,
          400,
        );
      },
    );
    await t.test(
      'an arbitrary notice version or missing/false acknowledgement cannot persist an enquiry',
      async () => {
        for (const body of [
          { ...enquiry, noticeVersion: 'invented' },
          { ...enquiry, noticeAcknowledged: undefined },
          { ...enquiry, noticeAcknowledged: false },
        ]) {
          const result = await service(
            request('/v1/enquiries', {
              method: 'POST',
              body,
              headers: { 'Idempotency-Key': id(305) },
            }),
          );
          assert.equal(result.status, 400);
          assert.equal((await result.json()).error.code, 'NOTICE_ACKNOWLEDGEMENT_REQUIRED');
        }
        assert.equal(
          (await (await service(request('/v1/staff/enquiries', { actor: 'admin' }))).json()).items
            .length,
          1,
        );
      },
    );
    await t.test('payload content type and streamed size are bounded', async () => {
      assert.equal(
        (
          await service(
            request('/v1/enquiries', {
              method: 'POST',
              body: enquiry,
              headers: { 'Content-Type': 'text/plain', 'Idempotency-Key': id(302) },
            }),
          )
        ).status,
        415,
      );
      const oversized = new Request('https://synthetic.invalid/v1/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id(302) },
        body: JSON.stringify({ ...enquiry, message: 'x'.repeat(17000) }),
      });
      assert.equal((await service(oversized)).status, 413);
      const malformed = new Request('https://synthetic.invalid/v1/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id(302) },
        body: '{',
      });
      assert.equal((await service(malformed)).status, 400);
    });
    await t.test(
      'transaction-local identity and role are cleared after successes and failures',
      async () => {
        await service(request('/v1/staff/listings', { actor: 'admin' }));
        await service(
          request(`/v1/staff/listings/${CREATED}/drafts/1`, {
            method: 'PUT',
            actor: 'peer',
            body: { expectedVersion: 2, content },
          }),
        );
        const state = (
          await db.query(
            `SELECT current_user AS role,current_setting('realtor.actor_id',true) AS actor,current_setting('realtor.tenant_id',true) AS tenant`,
          )
        ).rows[0];
        assert.equal(state.role, 'api_test_login');
        assert.ok(state.actor === '' || state.actor === null);
        assert.ok(state.tenant === '' || state.tenant === null);
        assert.equal(fixtureData.getDestroyed(), 0);
      },
    );
    await t.test(
      "reassignment immediately revokes creator's access on the next API request",
      async () => {
        await database.transaction(
          { tenantId: T, actorId: ADMIN, correlationId: 'synthetic-reassign' },
          (query) => query.query('SELECT app_api.reassign_listing($1,1,$2)', [CREATED, PEER]),
        );
        const former = (
          await (await service(request('/v1/staff/listings', { actor: 'agent' }))).json()
        ).items;
        assert.equal(
          former.some((row) => row.id === CREATED),
          false,
        );
        assert.equal(
          (
            await service(
              request(`/v1/staff/listings/${CREATED}/drafts/1`, {
                method: 'PUT',
                actor: 'agent',
                body: { expectedVersion: 2, content },
              }),
            )
          ).status,
          404,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test('bounded local limiter expires quotas without evicting live entries to admit attackers', () => {
  let now = 1000;
  const limiter = createLocalEnquiryLimiter({
    limit: 2,
    maxEntries: 1,
    windowMs: 10000,
    now: () => now,
  });
  assert.equal(limiter.consume('tenant:socket-a').allowed, true);
  assert.equal(limiter.consume('tenant:socket-b').allowed, false);
  assert.equal(limiter.consume('tenant:socket-a').allowed, true);
  assert.deepEqual(limiter.consume('tenant:socket-a'), { allowed: false, retryAfterSeconds: 10 });
  now = 11000;
  assert.equal(limiter.consume('tenant:socket-b').allowed, true);
});

test('failed rollback destroys pooled connection rather than returning contaminated state', async () => {
  let released;
  const safe = {
    currentUser: 'api_login',
    sessionUser: 'api_login',
    superuser: false,
    bypassRls: false,
    inheritsRoles: false,
    canAdminister: false,
    ownerMember: false,
    runtimeMember: true,
    otherRoleMembership: false,
    schemaOwner: false,
    tableOwner: false,
    canCreateInApp: false,
    unsafeRuntime: false,
    runtimeOwnsData: false,
  };
  const database = new PostgresTransactionDatabase({
    async connect() {
      return {
        async query(sql) {
          if (sql === 'ROLLBACK') throw new Error('Synthetic broken connection');
          return { rows: sql.startsWith('SELECT current_user') ? [safe] : [] };
        },
        release(destroy) {
          released = destroy;
        },
      };
    },
  });
  await assert.rejects(() =>
    database.transaction({ tenantId: T, actorId: AGENT, correlationId: 'synthetic' }, async () => {
      throw new Error('Synthetic transaction failure');
    }),
  );
  assert.equal(released, true);
});
