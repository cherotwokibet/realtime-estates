import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiClientError,
  RealtorApiClient,
  validateStaffEnquirySummaryV2,
  validateStaffEnquiryDetailV2,
  validateEnquiryOperationReceiptV2,
} from '../dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ENQUIRY = id(100),
  LISTING = id(200),
  AGENT = id(300),
  OTHER = id(301),
  OPERATION = id(400),
  REQUEST = id(900);
const NOW = '2026-10-12T08:20:30.000Z',
  NEXT = '2026-10-13T12:00:00.000Z',
  OPTIONS = { bearerToken: 'synthetic-staff' };
const ORIGIN = 'https://enquiries.example.invalid';
const client = (fetch, extra = {}) =>
  new RealtorApiClient({ baseUrl: ORIGIN, privacyNoticeVersion: 'synthetic-v1', fetch, ...extra });
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST, ...headers },
  });
const raw = (value, status = 200) =>
  new Response(value, {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST },
  });
const summary = (patch = {}) => ({
  id: ENQUIRY,
  listingId: LISTING,
  contactedRevision: 2,
  name: 'Synthetic prospect',
  origin: 'web',
  status: 'new',
  assignedAgentId: null,
  nextActionAt: null,
  version: '1',
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});
const detail = (patch = {}) => ({
  ...summary(),
  phone: '+254712345678',
  email: null,
  message: 'Synthetic enquiry only.',
  noticeVersion: 'synthetic-v1',
  closureReason: null,
  ...patch,
});
const assign = (patch = {}) => ({
  operationId: OPERATION,
  kind: 'assign',
  expectedVersion: '1',
  assignedAgentId: AGENT,
  status: null,
  nextActionAt: null,
  reason: null,
  ...patch,
});
const transition = (patch = {}) =>
  assign({
    kind: 'transition',
    assignedAgentId: null,
    status: 'contacted',
    nextActionAt: NEXT,
    ...patch,
  });
const reschedule = (patch = {}) =>
  assign({ kind: 'reschedule', assignedAgentId: null, nextActionAt: NEXT, ...patch });
function receipt(command = assign(), patch = {}) {
  const { operationId, kind, expectedVersion, assignedAgentId, status, nextActionAt, reason } =
    command;
  return {
    operationId,
    enquiryId: ENQUIRY,
    kind,
    expectedVersion,
    request: { assignedAgentId, status, nextActionAt, reason },
    outcome: 'applied',
    reason: null,
    result: {
      version: String(BigInt(expectedVersion) + 1n),
      status: kind === 'assign' ? 'assigned' : kind === 'reschedule' ? 'contacted' : status,
      assignedAgentId: AGENT,
      nextActionAt: kind === 'assign' ? null : nextActionAt,
      closureReason: kind === 'transition' ? reason : null,
    },
    completedAt: NOW,
    ...patch,
  };
}
const rejects = (operation, kind, uncertain = false) =>
  assert.rejects(
    operation,
    (error) =>
      error instanceof ApiClientError &&
      error.kind === kind &&
      error.submissionUncertain === uncertain,
  );
const operationGet = (api) => api.getEnquiryOperationV2(ENQUIRY, OPERATION, OPTIONS);

test('bounded staff pages and assignee picker use only explicit per-call identity and freeze narrow projections', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return url.includes('enquiry-assignees')
        ? json({
            items: [
              { userId: AGENT, role: 'agent' },
              { userId: OTHER, role: 'admin' },
            ],
            limit: 100,
            truncated: false,
          })
        : url.includes('limit=1')
          ? json({ items: [summary()], limit: 1, truncated: true })
          : json({ items: [], limit: 50, truncated: false });
    });
  const page = await api.listStaffEnquiriesV2({ ...OPTIONS, limit: 1 }),
    empty = await api.listStaffEnquiriesV2({ bearerToken: 'second' }),
    picker = await api.listEnquiryAssigneesV2(OPTIONS);
  assert.deepEqual(page, { items: [summary()], limit: 1, truncated: true });
  assert.deepEqual(empty, { items: [], limit: 50, truncated: false });
  assert.deepEqual(picker.items, [
    { userId: AGENT, role: 'agent' },
    { userId: OTHER, role: 'admin' },
  ]);
  assert.ok(
    Object.isFrozen(page) &&
      Object.isFrozen(page.items) &&
      Object.isFrozen(page.items[0]) &&
      Object.isFrozen(picker.items[0]),
  );
  assert.equal(Object.hasOwn(page.items[0], 'phone'), false);
  assert.equal(Object.hasOwn(page.items[0], 'message'), false);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      `${ORIGIN}/v2/staff/enquiries?limit=1`,
      `${ORIGIN}/v2/staff/enquiries?limit=50`,
      `${ORIGIN}/v2/staff/enquiry-assignees?limit=100`,
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.init.headers.Authorization),
    ['Bearer synthetic-staff', 'Bearer second', 'Bearer synthetic-staff'],
  );
  for (const { init } of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test('detail preserves legitimate multiline original contact text and canonicalizes only UUID selectors', async () => {
  const value = detail({
      name: '  Synthetic prospect  ',
      message: 'First line\nSecond\titem\r\nLast line 😀\u0085',
      email: 'synthetic@example.invalid',
    }),
    calls = [];
  const result = await client(async (url, init) => {
    calls.push({ url, init });
    return json(value);
  }).getStaffEnquiryV2(ENQUIRY.toUpperCase(), OPTIONS);
  assert.deepEqual(result, value);
  assert.ok(Object.isFrozen(result));
  assert.equal(calls[0].url, `${ORIGIN}/v2/staff/enquiries/${ENQUIRY}`);
  assert.deepEqual(
    validateStaffEnquirySummaryV2(summary({ listingId: null, contactedRevision: null })),
    summary({ listingId: null, contactedRevision: null }),
  );
});

test('staff options and limits are strict own snapshotted data and reject authority overrides before IO', async () => {
  let calls = 0,
    getters = 0;
  const api = client(async () => {
      calls++;
      return json({ items: [], limit: 50, truncated: false });
    }),
    accessor = {};
  Object.defineProperty(accessor, 'bearerToken', {
    enumerable: true,
    get() {
      getters++;
      return 'never';
    },
  });
  const hidden = { ...OPTIONS };
  Object.defineProperty(hidden, 'actorId', { value: OTHER });
  const invalid = [
    undefined,
    null,
    {},
    accessor,
    hidden,
    { ...OPTIONS, [Symbol('x')]: true },
    Object.assign(Object.create({ tenantId: OTHER }), OPTIONS),
    { ...OPTIONS, tenantId: OTHER },
    { bearerToken: '' },
    { bearerToken: 'bad\nheader' },
    { ...OPTIONS, signal: {} },
    { ...OPTIONS, timeoutMs: 0 },
  ];
  for (const options of invalid) {
    await rejects(() => api.listStaffEnquiriesV2(options), 'VALIDATION');
    await rejects(() => api.getStaffEnquiryV2(ENQUIRY, options), 'VALIDATION');
    await rejects(() => api.applyEnquiryOperationV2(ENQUIRY, assign(), options), 'VALIDATION');
  }
  for (const limit of [null, 0, -1, 101, 1.5, '1', NaN, Infinity])
    await rejects(() => api.listStaffEnquiriesV2({ ...OPTIONS, limit }), 'VALIDATION');
  await rejects(() => api.getStaffEnquiryV2(ENQUIRY, { ...OPTIONS, limit: 1 }), 'VALIDATION');
  assert.equal(getters, 0);
  assert.equal(calls, 0);
  const options = { bearerToken: 'original', limit: 1, timeoutMs: 1000 };
  let seen;
  const pending = client(async (url, init) => {
    seen = { url, init };
    options.bearerToken = 'changed';
    options.limit = 99;
    return json({ items: [], limit: 1, truncated: false });
  }).listStaffEnquiriesV2(options);
  options.bearerToken = 'later';
  await pending;
  assert.equal(seen.init.headers.Authorization, 'Bearer original');
  assert.equal(seen.url, `${ORIGIN}/v2/staff/enquiries?limit=1`);
});

test('invalid resource selectors and every malformed command fail before IO', async () => {
  let calls = 0,
    getters = 0;
  const api = client(async () => {
    calls++;
    return json(receipt());
  });
  for (const selected of ['bad', `${ENQUIRY}?tenant=other`, null, 1]) {
    await rejects(() => api.getStaffEnquiryV2(selected, OPTIONS), 'VALIDATION');
    await rejects(() => api.getEnquiryOperationV2(selected, OPERATION, OPTIONS), 'VALIDATION');
    await rejects(() => api.applyEnquiryOperationV2(selected, assign(), OPTIONS), 'VALIDATION');
  }
  await rejects(() => api.getEnquiryOperationV2(ENQUIRY, 'bad', OPTIONS), 'VALIDATION');
  const accessor = assign();
  Object.defineProperty(accessor, 'kind', {
    enumerable: true,
    get() {
      getters++;
      return 'assign';
    },
  });
  const missing = assign();
  delete missing.reason;
  const hidden = assign();
  Object.defineProperty(hidden, 'tenantId', { value: OTHER });
  const bad = [
    null,
    [],
    accessor,
    hidden,
    missing,
    { ...assign(), [Symbol('x')]: true },
    Object.assign(Object.create({}), assign()),
    assign({ actorId: OTHER }),
    assign({ operationId: 'bad' }),
    assign({ kind: 'automatic' }),
    assign({ assignedAgentId: null }),
    assign({ status: 'assigned' }),
    assign({ reason: 'unused' }),
    assign({ nextActionAt: NEXT }),
    reschedule({ nextActionAt: null }),
    reschedule({ status: 'contacted' }),
    transition({ status: 'contacted', nextActionAt: null }),
    transition({ status: 'closed_won', nextActionAt: NEXT }),
    transition({ status: 'closed_lost', nextActionAt: null, reason: null }),
    transition({ status: 'new', nextActionAt: null, reason: null }),
    transition({ status: 'qualified', reason: 'unused' }),
    transition({ status: 'spam', nextActionAt: null, reason: ' untrimmed ' }),
    transition({ status: 'spam', nextActionAt: null, reason: 'a'.repeat(1001) }),
    transition({ status: 'spam', nextActionAt: null, reason: 'bad\nreason' }),
    transition({ status: 'spam', nextActionAt: null, reason: 'bad\ud800' }),
  ];
  for (const value of bad)
    await rejects(() => api.applyEnquiryOperationV2(ENQUIRY, value, OPTIONS), 'VALIDATION');
  for (const expectedVersion of [
    '0',
    '01',
    '1.0',
    '1e0',
    '+1',
    ' 1',
    1,
    null,
    '9007199254740991',
    '9223372036854775807',
  ])
    await rejects(
      () => api.applyEnquiryOperationV2(ENQUIRY, assign({ expectedVersion }), OPTIONS),
      'VALIDATION',
    );
  for (const nextActionAt of [
    '0000-01-01T00:00:00.000Z',
    '2026-02-30T00:00:00.000Z',
    '2026-10-12T12:00:00Z',
    '2026-10-12T12:00:00.000000Z',
    '2026-10-12T12:00:00.000+00:00',
  ])
    await rejects(
      () => api.applyEnquiryOperationV2(ENQUIRY, reschedule({ nextActionAt }), OPTIONS),
      'VALIDATION',
    );
  assert.equal(getters, 0);
  assert.equal(calls, 0);
});

test('command POST snapshots the complete original request and sends a safe numeric version exactly once', async () => {
  const original = assign({ expectedVersion: '9007199254740990' }),
    expected = structuredClone(original),
    options = { ...OPTIONS, timeoutMs: 1000 };
  let seen;
  const api = client(async (url, init) => {
    seen = { url, init, wire: JSON.parse(init.body) };
    original.assignedAgentId = OTHER;
    original.operationId = id(999);
    original.expectedVersion = '2';
    options.bearerToken = 'changed';
    await new Promise((resolve) => setImmediate(resolve));
    return json(receipt(expected));
  });
  const pending = api.applyEnquiryOperationV2(ENQUIRY.toUpperCase(), original, options);
  original.reason = 'changed after call';
  const result = await pending;
  assert.equal(result.result.version, '9007199254740991');
  assert.deepEqual(result.request, {
    assignedAgentId: AGENT,
    status: null,
    nextActionAt: null,
    reason: null,
  });
  assert.deepEqual(seen.wire, { ...expected, expectedVersion: 9007199254740990 });
  assert.equal(seen.url, `${ORIGIN}/v2/staff/enquiries/${ENQUIRY}/operations`);
  assert.equal(seen.init.headers.Authorization, 'Bearer synthetic-staff');
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.equal(seen.init.headers['Idempotency-Key'], undefined);
  assert.ok(
    Object.isFrozen(result) && Object.isFrozen(result.request) && Object.isFrozen(result.result),
  );
});

test('valid assignment, transition, reopening, reschedule, noop and historical failure receipts remain explicit', async () => {
  const commands = [
    assign(),
    transition(),
    transition({ status: 'qualified' }),
    transition({ status: 'closed_won', nextActionAt: null }),
    transition({ status: 'closed_lost', nextActionAt: null, reason: 'No longer looking' }),
    transition({ status: 'spam', nextActionAt: null, reason: 'Synthetic spam' }),
    transition({ status: 'new', nextActionAt: null, reason: 'Reopen requested' }),
    transition({ status: 'assigned', nextActionAt: null, reason: 'Reopen requested' }),
    reschedule({ nextActionAt: '2020-01-01T00:00:00.000Z' }),
  ];
  for (const command of commands) {
    const result = await client(async () => json(receipt(command))).applyEnquiryOperationV2(
      ENQUIRY,
      command,
      OPTIONS,
    );
    assert.equal(result.kind, command.kind);
    assert.equal(result.outcome, 'applied');
  }
  for (const command of [assign(), reschedule()]) {
    const value = receipt(command, { outcome: 'noop' });
    value.result.version = '1';
    assert.equal(
      (await client(async () => json(value)).applyEnquiryOperationV2(ENQUIRY, command, OPTIONS))
        .outcome,
      'noop',
    );
  }
  const cases = [
    receipt(assign(), {
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      result: {
        version: '7',
        status: 'qualified',
        assignedAgentId: OTHER,
        nextActionAt: NEXT,
        closureReason: null,
      },
    }),
    receipt(assign(), {
      outcome: 'rejected',
      reason: 'ASSIGNEE_UNAVAILABLE',
      result: {
        version: '1',
        status: 'new',
        assignedAgentId: null,
        nextActionAt: null,
        closureReason: null,
      },
    }),
    receipt(transition(), {
      outcome: 'rejected',
      reason: 'INVALID_TRANSITION',
      result: {
        version: '1',
        status: 'new',
        assignedAgentId: null,
        nextActionAt: null,
        closureReason: null,
      },
    }),
    receipt(reschedule(), {
      outcome: 'rejected',
      reason: 'INVALID_TRANSITION',
      result: {
        version: '1',
        status: 'assigned',
        assignedAgentId: AGENT,
        nextActionAt: null,
        closureReason: null,
      },
    }),
  ];
  for (const value of cases) {
    const result = await operationGet(client(async () => json(value)));
    assert.deepEqual(result, value);
  }
});

test('response pages reject oversize, incomplete truncation, private fields, duplicates and wrong limits', async () => {
  const bad = [
    { items: [], limit: 2, truncated: true },
    { items: [summary(), summary()], limit: 2, truncated: false },
    {
      items: [summary(), summary({ id: OTHER }), summary({ id: AGENT })],
      limit: 2,
      truncated: false,
    },
    { items: [], limit: 1, truncated: false },
    { items: [], limit: 2, truncated: 'false' },
    { items: [], limit: 2 },
    { items: [], limit: 2, truncated: false, total: 99 },
    { items: [{ ...summary(), phone: '+254712345678' }], limit: 2, truncated: false },
  ];
  for (const value of bad)
    await rejects(
      () => client(async () => json(value)).listStaffEnquiriesV2({ ...OPTIONS, limit: 2 }),
      'INVALID_RESPONSE',
    );
  const directory = [
    { items: [{ userId: AGENT, role: 'customer' }], limit: 2, truncated: false },
    {
      items: [{ userId: AGENT, role: 'agent', name: 'Private person' }],
      limit: 2,
      truncated: false,
    },
    {
      items: [
        { userId: AGENT, role: 'agent' },
        { userId: AGENT, role: 'admin' },
      ],
      limit: 2,
      truncated: false,
    },
    { items: [], limit: 2, truncated: true },
    { items: [], limit: 100, truncated: false },
  ];
  for (const value of directory)
    await rejects(
      () => client(async () => json(value)).listEnquiryAssigneesV2({ ...OPTIONS, limit: 2 }),
      'INVALID_RESPONSE',
    );
});

test('summary and detail validators enforce scope, canonical dates, bounded versions and private contacts', async () => {
  const summaries = [
    summary({ id: 'bad' }),
    summary({ listingId: null }),
    summary({ contactedRevision: null }),
    summary({ contactedRevision: 0 }),
    summary({ origin: 'other' }),
    summary({ status: 'viewing' }),
    summary({ status: 'contacted' }),
    summary({ assignedAgentId: 'bad' }),
    summary({ version: 1 }),
    summary({ version: '01' }),
    summary({ version: '9007199254740992' }),
    summary({ name: ' ' }),
    summary({ name: 'a'.repeat(161) }),
    summary({ name: 'bad\tname' }),
    summary({ name: 'bad\ud800' }),
    summary({ createdAt: '0000-01-01T00:00:00.000Z' }),
    summary({ updatedAt: '2026-10-11T08:20:30.000Z' }),
    summary({ createdAt: NOW.replace('.000Z', 'Z') }),
  ];
  for (const value of summaries)
    await rejects(
      () =>
        client(async () =>
          json({ items: [value], limit: 50, truncated: false }),
        ).listStaffEnquiriesV2(OPTIONS),
      'INVALID_RESPONSE',
    );
  const details = [
    detail({ id: OTHER }),
    detail({ phone: '0712345678' }),
    detail({ phone: null, email: null }),
    detail({ email: 'bad@address' }),
    detail({ message: ' ' }),
    detail({ message: 'a'.repeat(2001) }),
    detail({ message: 'bad\u0000message' }),
    detail({ message: 'bad\udfff' }),
    detail({ noticeVersion: 'a'.repeat(101) }),
    detail({ status: 'closed_lost' }),
    detail({ closureReason: ' untrimmed ' }),
    { ...detail(), tenantId: OTHER },
  ];
  for (const value of details)
    await rejects(
      () => client(async () => json(value)).getStaffEnquiryV2(ENQUIRY, OPTIONS),
      'INVALID_RESPONSE',
    );
  assert.equal(
    validateStaffEnquirySummaryV2(summary({ version: '9007199254740991' })).version,
    '9007199254740991',
  );
  assert.equal(
    validateStaffEnquiryDetailV2(
      detail({ phone: null, email: 'synthetic@example.invalid' }),
      ENQUIRY,
    ).phone,
    null,
  );
});

test('ordinary exact data records reject inherited, hidden, accessor and symbol fields without evaluation', () => {
  let getters = 0;
  const value = summary();
  Object.defineProperty(value, 'name', {
    enumerable: true,
    get() {
      getters++;
      throw new Error('caller getter');
    },
  });
  for (const input of [
    value,
    Object.assign(Object.create({}), summary()),
    { ...summary(), [Symbol('x')]: true },
  ])
    assert.throws(
      () => validateStaffEnquirySummaryV2(input),
      (error) => error.kind === 'INVALID_RESPONSE',
    );
  const hidden = summary();
  Object.defineProperty(hidden, 'token', { value: 'private' });
  assert.throws(
    () => validateStaffEnquirySummaryV2(hidden),
    (error) => error.kind === 'INVALID_RESPONSE',
  );
  assert.deepEqual(
    validateStaffEnquirySummaryV2(Object.assign(Object.create(null), summary())),
    summary(),
  );
  assert.equal(getters, 0);
  const receiptValue = receipt();
  Object.defineProperty(receiptValue.result, 'status', {
    enumerable: true,
    get() {
      getters++;
      return 'assigned';
    },
  });
  assert.throws(
    () => validateEnquiryOperationReceiptV2(receiptValue, ENQUIRY, OPERATION),
    (error) => error.kind === 'INVALID_RESPONSE',
  );
  assert.equal(getters, 0);
});

test('POST rejects mismatched original identity and request facts as uncertain without retrying', async () => {
  const base = receipt(),
    values = [
      { ...base, enquiryId: OTHER },
      { ...base, operationId: OTHER },
      {
        ...base,
        kind: 'reschedule',
        request: { assignedAgentId: null, status: null, nextActionAt: NEXT, reason: null },
      },
      { ...base, expectedVersion: '2', result: { ...base.result, version: '3' } },
      { ...base, request: { ...base.request, assignedAgentId: OTHER } },
      { ...base, request: { ...base.request, reason: 'unexpected' } },
      { ...base, request: { ...base.request, actorId: OTHER } },
      { ...base, result: { ...base.result, token: 'private' } },
    ];
  for (const value of values) {
    let calls = 0;
    await rejects(
      () =>
        client(async () => {
          calls++;
          return json(value);
        }).applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS),
      'INVALID_RESPONSE',
      true,
    );
    assert.equal(calls, 1);
  }
});

test('receipt outcomes, versions and resulting workflow facts cannot contradict their original command', async () => {
  const base = receipt(),
    invalid = [];
  const changed = (patch) => ({ ...base, ...patch });
  invalid.push(
    changed({ outcome: 'unknown' }),
    changed({ outcome: 'applied', reason: 'VERSION_CONFLICT' }),
    changed({ result: { ...base.result, version: '1' } }),
    changed({ result: { ...base.result, status: 'new' } }),
    changed({ result: { ...base.result, assignedAgentId: OTHER } }),
    changed({ outcome: 'noop', result: { ...base.result, version: '2' } }),
    changed({
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      result: { ...base.result, version: '1' },
    }),
    changed({ outcome: 'conflict', reason: null }),
    changed({
      outcome: 'rejected',
      reason: 'INVALID_TRANSITION',
      result: { ...base.result, version: '1' },
    }),
    changed({ outcome: 'rejected', reason: 'ASSIGNEE_UNAVAILABLE' }),
    changed({ completedAt: '0000-01-01T00:00:00.000Z' }),
  );
  const transitioned = receipt(transition());
  invalid.push(
    { ...transitioned, outcome: 'noop', result: { ...transitioned.result, version: '1' } },
    { ...transitioned, result: { ...transitioned.result, status: 'qualified' } },
    {
      ...transitioned,
      result: { ...transitioned.result, nextActionAt: '2026-10-14T00:00:00.000Z' },
    },
    { ...transitioned, result: { ...transitioned.result, closureReason: 'unexpected' } },
  );
  const rescheduled = receipt(reschedule());
  invalid.push(
    { ...rescheduled, result: { ...rescheduled.result, status: 'assigned' } },
    { ...rescheduled, result: { ...rescheduled.result, nextActionAt: null } },
  );
  for (const value of invalid)
    await rejects(() => operationGet(client(async () => json(value))), 'INVALID_RESPONSE');
});

test('raw decoded duplicate keys and noncanonical integer tokens are rejected before numeric rounding', async () => {
  const page = JSON.stringify({ items: [summary()], limit: 50, truncated: false });
  for (const source of [
    page.replace('"limit":50', '"limit":5e1'),
    page.replace('"limit":50', '"limit":50.0'),
    page.replace('"contactedRevision":2', '"contactedRevision":2e0'),
    page.replace('"contactedRevision":2', '"contactedRevision":2.00000000000000001'),
    page.replace('"name":"Synthetic prospect"', '"name":"Original","na\\u006de":"Changed"'),
  ])
    await rejects(
      () => client(async () => raw(source)).listStaffEnquiriesV2(OPTIONS),
      'INVALID_RESPONSE',
    );
  const command = JSON.stringify(receipt());
  for (const source of [
    command.replace('"expectedVersion":"1"', '"expectedVersion":"1","expected\\u0056ersion":"1"'),
    command.replace('"assignedAgentId":', '"assignedAgentId":null,"assigned\\u0041gentId":'),
  ])
    await rejects(
      () => client(async () => raw(source)).applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS),
      'INVALID_RESPONSE',
      true,
    );
});

test('safe staff errors require matching references and exact code/status while withholding upstream text', async () => {
  const cases = [
    [400, 'INVALID_INPUT'],
    [400, 'INVALID_JSON'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'INVALID_STATE'],
    [413, 'BODY_TOO_LARGE'],
    [415, 'JSON_REQUIRED'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
  ];
  for (const [status, code] of cases) {
    const value = {
      error: { code, message: 'private SQL and bearer details' },
      requestId: REQUEST,
    };
    let calls = 0;
    const api = client(async () => {
      calls++;
      return json(value, status, { 'Retry-After': '8' });
    });
    await assert.rejects(
      () => api.applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS),
      (error) =>
        error.kind === 'HTTP' &&
        error.status === status &&
        error.serverCode === code &&
        error.requestId === REQUEST &&
        error.retryAfterSeconds === 8 &&
        error.submissionUncertain === status >= 500 &&
        !error.message.includes('private SQL'),
    );
    assert.equal(calls, 1);
  }
  const base = { error: { code: 'FORBIDDEN', message: 'Denied' }, requestId: REQUEST };
  for (const [value, status, headers] of [
    [{ ...base, submissionUncertain: true }, 403, {}],
    [{ ...base, error: { code: 'PRIVATE_DATABASE_DETAIL', message: 'Denied' } }, 403, {}],
    [base, 404, {}],
    [{ ...base, error: { ...base.error, stack: 'private' } }, 403, {}],
    [base, 403, { 'X-Request-Id': OTHER }],
    [base, 403, { 'X-Request-Id': '' }],
  ])
    await rejects(
      () =>
        client(async () => json(value, status, headers)).applyEnquiryOperationV2(
          ENQUIRY,
          assign(),
          OPTIONS,
        ),
      'INVALID_RESPONSE',
      true,
    );
  const noHeader = json(base, 403);
  noHeader.headers.delete('x-request-id');
  await rejects(
    () => client(async () => noHeader).getStaffEnquiryV2(ENQUIRY, OPTIONS),
    'INVALID_RESPONSE',
  );
});

test('lost successful POST replies reconcile through historical GET without resending or adopting current state', async () => {
  const history = receipt(),
    calls = [];
  let currentVersion = '2';
  const api = client(async (url, init) => {
    calls.push({ url, method: init.method });
    if (init.method === 'POST') {
      currentVersion = '2';
      throw new Error('Lost successful reply after commit: private details');
    }
    return json(history);
  });
  await rejects(() => api.applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS), 'NETWORK', true);
  currentVersion = '9';
  const saved = await api.getEnquiryOperationV2(ENQUIRY, OPERATION, OPTIONS);
  assert.equal(saved.result.version, '2');
  assert.equal(currentVersion, '9');
  assert.deepEqual(calls, [
    { url: `${ORIGIN}/v2/staff/enquiries/${ENQUIRY}/operations`, method: 'POST' },
    { url: `${ORIGIN}/v2/staff/enquiries/${ENQUIRY}/operations/${OPERATION}`, method: 'GET' },
  ]);
  assert.deepEqual(validateEnquiryOperationReceiptV2(saved, ENQUIRY, OPERATION, assign()), history);
  assert.throws(
    () =>
      validateEnquiryOperationReceiptV2(
        saved,
        ENQUIRY,
        OPERATION,
        assign({ assignedAgentId: OTHER }),
      ),
    (error) => error.kind === 'INVALID_RESPONSE',
  );
});

test('timeout and cancellation bound ignored transports and mark only dispatched writes uncertain', async () => {
  let calls = 0;
  const never = client(
    async () => {
      calls++;
      return new Promise(() => {});
    },
    { timeoutMs: 10 },
  );
  await rejects(() => never.applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS), 'TIMEOUT', true);
  assert.equal(calls, 1);
  await rejects(() => never.getStaffEnquiryV2(ENQUIRY, OPTIONS), 'TIMEOUT');
  assert.equal(calls, 2);
  const stopped = new AbortController();
  stopped.abort();
  await rejects(
    () => never.applyEnquiryOperationV2(ENQUIRY, assign(), { ...OPTIONS, signal: stopped.signal }),
    'CANCELLED',
  );
  assert.equal(calls, 2);
  const controller = new AbortController(),
    late = client(async () => {
      queueMicrotask(() => controller.abort());
      return new Promise(() => {});
    });
  await rejects(
    () =>
      late.applyEnquiryOperationV2(ENQUIRY, assign(), { ...OPTIONS, signal: controller.signal }),
    'CANCELLED',
    true,
  );
});

test('malformed success status, redirects, non-JSON and lost text reads never produce write success', async () => {
  const responses = [
    () => json(receipt(), 201),
    () => new Response('HTML', { headers: { 'Content-Type': 'text/html' } }),
    () => raw('{'),
    () => json(receipt(), 302),
  ];
  for (const response of responses)
    await assert.rejects(
      () => client(async () => response()).applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS),
      (error) =>
        error instanceof ApiClientError &&
        error.submissionUncertain &&
        ['INVALID_RESPONSE', 'REDIRECT'].includes(error.kind),
    );
  const lost = {
    status: 200,
    ok: true,
    redirected: false,
    url: '',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    async text() {
      throw new Error('private body connection');
    },
  };
  await rejects(
    () => client(async () => lost).applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS),
    'NETWORK',
    true,
  );
  const redirected = {
    ...lost,
    url: ORIGIN + '/different',
    async text() {
      return JSON.stringify(receipt());
    },
  };
  await rejects(
    () => client(async () => redirected).applyEnquiryOperationV2(ENQUIRY, assign(), OPTIONS),
    'REDIRECT',
    true,
  );
});

test('enquiry options never leak to subsequent calls or change unchanged public enquiry transport', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return url.includes('/v2/staff/') ? json(detail()) : json({ id: ENQUIRY }, 201);
    });
  await api.getStaffEnquiryV2(ENQUIRY, OPTIONS);
  await api.submitEnquiry(
    {
      name: 'Synthetic',
      phone: '0712345678',
      email: null,
      message: 'General synthetic enquiry',
      origin: 'web',
      noticeVersion: 'synthetic-v1',
      noticeAcknowledged: true,
    },
    { idempotencyKey: OPERATION },
  );
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-staff');
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[1].url, ORIGIN + '/v1/enquiries');
  assert.equal(calls[1].init.headers['Idempotency-Key'], OPERATION);
});

test('activity SDK uses explicit identity and validates minimal supported coverage', async () => {
  const page = {
      items: [
        {
          eventId: ENQUIRY,
          kind: 'received',
          actorId: null,
          occurredAt: NOW,
          version: '1',
          status: 'new',
          assignedAgentId: null,
          nextActionAt: null,
        },
      ],
      limit: 50,
      truncated: false,
      coverage: 'capture-and-v2-operations',
      currentVersion: '1',
    },
    calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init });
    return json(page);
  });
  assert.equal((await api.listEnquiryActivityV2(ENQUIRY, OPTIONS)).currentVersion, '1');
  assert.equal(calls[0].url, ORIGIN + '/v2/staff/enquiries/' + ENQUIRY + '/activity?limit=50');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-staff');
  await assert.rejects(api.listEnquiryActivityV2(ENQUIRY, { ...OPTIONS, tenantId: OTHER }));
  await assert.rejects(
    client(async () => json({ ...page, coverage: 'complete' })).listEnquiryActivityV2(
      ENQUIRY,
      OPTIONS,
    ),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});

test('contact SDK preserves raw original facts and classifies malformed committed replies as uncertain', async () => {
  const input = {
      operationId: OPERATION,
      expectedVersion: '1',
      channel: 'call',
      outcome: 'no_response',
      occurredAt: NOW,
      notes: '  Raw notes\nRemain unchanged  ',
    },
    request = {
      channel: input.channel,
      outcome: input.outcome,
      occurredAt: input.occurredAt,
      notes: input.notes,
    },
    receipt = {
      operationId: OPERATION,
      enquiryId: ENQUIRY,
      actorId: AGENT,
      expectedVersion: '1',
      observedVersion: '1',
      request,
      outcome: 'applied',
      reason: null,
      entry: { entryId: OPERATION, actorId: AGENT, recordedAt: NOW, ...request },
      completedAt: NOW,
    },
    calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init });
    return json(receipt);
  });
  assert.deepEqual(await api.recordContactV2(ENQUIRY, input, OPTIONS), receipt);
  assert.equal(JSON.parse(calls[0].init.body).notes, input.notes);
  assert.equal(JSON.parse(calls[0].init.body).expectedVersion, 1);
  assert.deepEqual(await api.getContactReceiptV2(ENQUIRY, input, OPTIONS), receipt);
  assert.equal(calls[1].init.method, 'GET');
  await assert.rejects(
    api.getContactReceiptV2(ENQUIRY, { ...input, notes: 'Different' }, OPTIONS),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  await assert.rejects(
    client(async () =>
      json({ ...receipt, request: { ...request, notes: 'Different' } }),
    ).recordContactV2(ENQUIRY, input, OPTIONS),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  await assert.rejects(
    api.recordContactV2(ENQUIRY, { ...input, actorId: OTHER }, OPTIONS),
    (e) => e.kind === 'VALIDATION',
  );
});
