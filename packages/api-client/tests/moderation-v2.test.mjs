import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError, RealtorApiClient, validateStaffDraftContentV2 } from '../dist/index.js';

const ID = '00000000-0000-4000-8000-000000000100',
  ACTOR = '00000000-0000-4000-8000-000000000010';
const TIME = '2026-10-10T08:00:00.000Z';
const content = {
  title: 'Synthetic review studio',
  description: 'Synthetic moderation test, never real inventory.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000001,
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
  pricing: {
    declaration: 'incomplete',
    charges: [
      {
        id: 'legal',
        name: 'Legal quote',
        amountStatus: 'quote_required',
        amountMinor: null,
        timing: 'one_off',
        classification: 'fee',
        mandatory: true,
      },
    ],
  },
  location: { county: null, town: 'Synthetic town', area: null },
};
const summary = (patch = {}) => ({
  listingId: ID,
  slug: 'synthetic-review-studio',
  revision: 2,
  state: 'pending',
  version: '3',
  listingVersion: '8',
  title: content.title,
  purpose: content.purpose,
  propertyType: content.propertyType,
  amountMinor: content.amountMinor,
  rentPeriod: content.rentPeriod,
  submittedAt: TIME,
  submittedBy: ACTOR,
  publicationStatus: 'published',
  publishedRevision: 1,
  availability: 'available',
  lastAvailabilityConfirmedAt: TIME,
  acceptedPhotoCount: 4,
  ...patch,
});
const photos = Array.from({ length: 4 }, (_, index) => ({
  key: `synthetic/review-${index}.webp`,
  alt: `Synthetic view ${index}`,
}));
const detail = (patch = {}) => ({
  ...summary(),
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  content,
  photos,
  ...patch,
});
const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://review.example.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const options = { bearerToken: 'synthetic-admin' };
const approve = { expectedVersion: '3', decision: 'approve', reason: null };
const reject = (operation, kind, uncertain = false) =>
  assert.rejects(
    operation,
    (error) =>
      error instanceof ApiClientError &&
      error.kind === kind &&
      error.submissionUncertain === uncertain,
  );

test('moderation queue validates bounded immutable pending metadata and requires a bearer on each request', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init });
    return url.includes('/v1/properties')
      ? json({ items: [], limit: 50 })
      : json({ items: [summary()], limit: 1 });
  });
  const page = await api.listReviewsV2({ ...options, limit: 1 });
  assert.deepEqual(page, { items: [summary()], limit: 1 });
  assert.ok(Object.isFrozen(page) && Object.isFrozen(page.items) && Object.isFrozen(page.items[0]));
  assert.equal(calls[0].url, 'https://review.example.invalid/v2/staff/reviews?limit=1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-admin');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  await api.listProperties();
  assert.equal(calls[1].init.headers.Authorization, undefined);
  for (const bad of [
    {},
    { ...options, limit: 0 },
    { ...options, limit: 101 },
    { ...options, limit: 1.5 },
    { ...options, tenantId: ID },
  ])
    await reject(() => api.listReviewsV2(bad), 'VALIDATION');
  await reject(() => api.getReviewV2(ID, 2, {}), 'VALIDATION');
  await reject(() => api.decideReviewV2(ID, 2, approve, {}), 'VALIDATION');
  assert.equal(calls.length, 2);
});

test('review details retain raw private content, exact money/quotes/nulls and distinct listing/revision versions', async () => {
  const result = await client(async () => json(detail())).getReviewV2(ID, 2, options);
  assert.deepEqual(result, detail());
  assert.equal(result.version, '3');
  assert.equal(result.listingVersion, '8');
  assert.equal(result.content.amountMinor, 2000001);
  assert.equal(result.content.pricing.charges[0].amountMinor, null);
  assert.equal(result.content.privateAddress, content.privateAddress);
  assert.equal(result.content.location.county, null);
  for (const object of [
    result,
    result.content,
    result.content.pricing.charges,
    result.content.location,
    result.photos,
    result.photos[0],
  ])
    assert.ok(Object.isFrozen(object));
  const unfinished = validateStaffDraftContentV2({
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
  });
  const draft = detail({
    state: 'draft',
    title: null,
    purpose: null,
    propertyType: null,
    amountMinor: null,
    rentPeriod: null,
    submittedAt: null,
    submittedBy: null,
    content: unfinished,
    photos: [],
    acceptedPhotoCount: 0,
  });
  assert.deepEqual(await client(async () => json(draft)).getReviewV2(ID, 2, options), draft);
  for (const state of ['approved', 'rejected']) {
    const decided = detail({
      state,
      version: '4',
      decidedAt: TIME,
      decidedBy: ACTOR,
      decisionReason: state === 'rejected' ? 'Synthetic correction needed' : null,
    });
    assert.deepEqual(await client(async () => json(decided)).getReviewV2(ID, 2, options), decided);
  }
});

test('review responses fail closed on unknown/missing fields, nonpending queue states and unsafe numeric metadata', async () => {
  for (const patch of [
    { tenantId: ID },
    { state: 'approved' },
    { listingVersion: 8 },
    { version: '03' },
    { listingVersion: '9223372036854775808' },
    { amountMinor: 1.5 },
    { amountMinor: 0 },
    { acceptedPhotoCount: 13 },
    { publishedRevision: 0 },
    { publicationStatus: 'live' },
    { availability: 'let' },
    { submittedBy: 'admin' },
    { submittedAt: null },
    { title: null },
    { rentPeriod: null },
  ])
    await reject(
      () => client(async () => json({ items: [summary(patch)], limit: 50 })).listReviewsV2(options),
      'INVALID_RESPONSE',
    );
  const missing = summary();
  delete missing.listingVersion;
  for (const page of [
    { items: [missing], limit: 50 },
    { items: [summary(), summary()], limit: 50 },
    { items: [], limit: 49 },
    { items: [], limit: 50, tenantId: ID },
  ])
    await reject(() => client(async () => json(page)).listReviewsV2(options), 'INVALID_RESPONSE');
  const missingDetail = detail();
  delete missingDetail.decidedAt;
  for (const payload of [
    missingDetail,
    detail({ tenantId: ID }),
    detail({ content: { ...content, assignedAgentId: ACTOR } }),
    detail({ state: 'published' }),
  ])
    await reject(
      () => client(async () => json(payload)).getReviewV2(ID, 2, options),
      'INVALID_RESPONSE',
    );
});

test('review timestamp, decision-state and requested-resource metadata must be coherent', async () => {
  for (const submittedAt of [
    '2026-02-30T08:00:00.000Z',
    '2026-10-10T08:00:00Z',
    '2026-10-10T08:00:00.000+00:00',
    'not-time',
  ])
    await reject(
      () => client(async () => json(detail({ submittedAt }))).getReviewV2(ID, 2, options),
      'INVALID_RESPONSE',
    );
  for (const patch of [
    { listingId: ACTOR },
    { revision: 3 },
    { submittedBy: null },
    { lastAvailabilityConfirmedAt: 'invalid' },
    { decidedAt: TIME },
    { decidedBy: ACTOR },
    { state: 'approved' },
    { state: 'rejected', decidedAt: TIME, decidedBy: ACTOR, decisionReason: ' ' },
    { decisionReason: 'Unexpected pending reason' },
    { title: 'Conflicting title' },
    { amountMinor: 2000002 },
  ])
    await reject(
      () => client(async () => json(detail(patch))).getReviewV2(ID, 2, options),
      'INVALID_RESPONSE',
    );
  const maximum = detail({ version: '9223372036854775807', listingVersion: '9223372036854775807' });
  assert.equal(
    (await client(async () => json(maximum)).getReviewV2(ID, 2, options)).listingVersion,
    '9223372036854775807',
  );
});

test('review accepted-photo references must match the count and remain bounded safe metadata', async () => {
  for (const patch of [
    { acceptedPhotoCount: 3 },
    { photos: [...photos.slice(0, 3), photos[0]] },
    {
      photos: [
        ...photos.slice(0, 3),
        { key: 'https://foreign.invalid/photo.jpg', alt: 'Synthetic' },
      ],
    },
    { photos: [...photos.slice(0, 3), { key: '../private.jpg', alt: 'Synthetic' }] },
    { photos: [...photos.slice(0, 3), { ...photos[3], secret: 'private' }] },
    { photos: [...photos.slice(0, 3), { ...photos[3], alt: '😀'.repeat(301) }] },
  ])
    await reject(
      () => client(async () => json(detail(patch))).getReviewV2(ID, 2, options),
      'INVALID_RESPONSE',
    );
  const maximum = detail({ photos: photos.map((photo) => ({ ...photo, alt: '😀'.repeat(300) })) });
  assert.equal(
    (await client(async () => json(maximum)).getReviewV2(ID, 2, options)).photos[0].alt,
    maximum.photos[0].alt,
  );
});

test('moderation decisions send a safe numeric revision version and enforce exact decision/reason input before transport', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init });
    return json({
      version: '4',
      state: JSON.parse(init.body).decision === 'approve' ? 'approved' : 'rejected',
    });
  });
  assert.deepEqual(await api.decideReviewV2(ID, 2, approve, options), {
    version: '4',
    state: 'approved',
  });
  assert.equal(
    calls[0].url,
    `https://review.example.invalid/v2/staff/reviews/${ID}/revisions/2/decision`,
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Idempotency-Key'], undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    expectedVersion: 3,
    decision: 'approve',
    reason: null,
  });
  const reason = '😀'.repeat(1000);
  assert.equal(
    (await api.decideReviewV2(ID, 2, { ...approve, decision: 'reject', reason }, options)).state,
    'rejected',
  );
  for (const patch of [
    { expectedVersion: 3 },
    { expectedVersion: '03' },
    { expectedVersion: '0' },
    { expectedVersion: '9007199254740992' },
    { decision: 'publish' },
    { reason: 'Approval explanation' },
    { decision: 'reject', reason: null },
    { decision: 'reject', reason: ' ' },
    { decision: 'reject', reason: ' padded ' },
    { decision: 'reject', reason: 'a\nb' },
    { decision: 'reject', reason: 'a\u0085b' },
    { decision: 'reject', reason: '\ud800' },
    { decision: 'reject', reason: '😀'.repeat(1001) },
    { role: 'admin' },
  ])
    await reject(() => api.decideReviewV2(ID, 2, { ...approve, ...patch }, options), 'VALIDATION');
  await reject(() => api.getReviewV2('bad', 2, options), 'VALIDATION');
  await reject(() => api.decideReviewV2(ID, 0, approve, options), 'VALIDATION');
  assert.equal(calls.length, 2);
});

test('moderation HTTP authorization/state conflicts are definite typed outcomes with no retries', async () => {
  for (const [status, code] of [
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [409, 'CONFLICT'],
    [422, 'INVALID_STATE'],
  ]) {
    let calls = 0;
    const api = client(async () => {
      calls++;
      return json(
        { error: { code, message: 'PRIVATE synthetic provider/SQL detail' }, requestId: ACTOR },
        status,
      );
    });
    await assert.rejects(
      () => api.decideReviewV2(ID, 2, approve, options),
      (error) =>
        error.kind === 'HTTP' &&
        error.status === status &&
        error.serverCode === code &&
        !error.submissionUncertain &&
        !error.message.includes('PRIVATE'),
    );
    assert.equal(calls, 1);
  }
});

test('moderation decision loss, timeout, redirects and invalid receipts remain uncertain without automatic retries', async () => {
  for (const [transport, kind] of [
    [
      async () => {
        throw new Error('PRIVATE transport');
      },
      'NETWORK',
    ],
    [async () => json({ version: '4', state: 'rejected' }), 'INVALID_RESPONSE'],
    [async () => json({ version: 4, state: 'approved' }), 'INVALID_RESPONSE'],
    [async () => json({ version: '4', state: 'approved', published: true }), 'INVALID_RESPONSE'],
    [async () => json({ version: '4', state: 'approved' }, 201), 'INVALID_RESPONSE'],
    [async () => new Response(null, { status: 302 }), 'REDIRECT'],
    [
      async () =>
        json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'PRIVATE' }, requestId: ACTOR }, 503),
      'HTTP',
    ],
    [async () => new Promise(() => {}), 'TIMEOUT'],
  ]) {
    let calls = 0;
    await reject(
      () =>
        client(async (...args) => {
          calls++;
          return transport(...args);
        }).decideReviewV2(ID, 2, approve, { ...options, timeoutMs: 20 }),
      kind,
      true,
    );
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await reject(
    () =>
      client(async () => {
        calls++;
        return json({ version: '4', state: 'approved' });
      }).decideReviewV2(ID, 2, approve, { ...options, signal: controller.signal }),
    'CANCELLED',
  );
  assert.equal(calls, 0);
});

test('moderation v2 parses original money tokens before rounding in summaries and full detail content', async () => {
  for (const raw of [
    JSON.stringify({ items: [summary()], limit: 50 }).replace(
      '"amountMinor":2000001',
      '"amountMinor":2000001.00000000001',
    ),
    JSON.stringify({ items: [summary()], limit: 50 }).replace(
      '"amountMinor":2000001',
      '"amount\\u004dinor":2.000001e6',
    ),
  ])
    await reject(
      () =>
        client(
          async () => new Response(raw, { headers: { 'Content-Type': 'application/json' } }),
        ).listReviewsV2(options),
      'INVALID_RESPONSE',
    );
  const raw = JSON.stringify(detail()).replaceAll(
    '"amountMinor":2000001',
    '"amountMinor":2000001.00000000001',
  );
  await reject(
    () =>
      client(
        async () => new Response(raw, { headers: { 'Content-Type': 'application/json' } }),
      ).getReviewV2(ID, 2, options),
    'INVALID_RESPONSE',
  );
});
