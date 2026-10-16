import { outcomeFixture } from '../../../packages/domain/test-helpers/viewing-outcome-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2),
  enquiry = id(3),
  viewing = id(4),
  listing = id(5),
  operation = id(6),
  time = '2026-10-13T20:00:00.000Z';
const slot = {
  startAt: '2090-01-01T09:00:00.000Z',
  endAt: '2090-01-01T10:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const body = {
  operationId: operation,
  expectedEnquiryVersion: 2,
  listingId: listing,
  preferredSlots: [slot],
  notes: '  Private synthetic viewing.  ',
};
const schedule = {
  viewingId: viewing,
  enquiryId: enquiry,
  listingId: listing,
  version: '1',
  status: 'requested',
  preferredSlots: [slot],
  proposedSlot: null,
};
const receipt = {
  operationId: operation,
  enquiryId: enquiry,
  viewingId: viewing,
  actorId: actor,
  kind: 'request',
  expectedVersion: '2',
  observedVersion: '2',
  request: { listingId: listing, preferredSlots: [slot], notes: body.notes },
  outcome: 'applied',
  reason: null,
  result: schedule,
  completedAt: time,
};
const detail = {
  schedule,
  notes: body.notes,
  requestedById: actor,
  assignedAgentId: actor,
  createdAt: time,
  updatedAt: time,
};
const base = `/v2/staff/enquiries/${enquiry}`;
function fixture({
  result = receipt,
  privateDetail = detail,
  page = { items: [detail], limit: 25, truncated: false },
  role = 'agent',
  failure,
} = {}) {
  const calls = [],
    contexts = [];
  const database = {
    async transaction(context, work) {
      contexts.push(context);
      return work({
        async query(sql, args) {
          calls.push({ sql, args });
          if (sql.includes('staff_role')) return { rows: [{ role }] };
          if (failure) throw failure;
          if (sql.includes('list_enquiry_viewings') || sql.includes('read_viewing_history'))
            return { rows: [{ page }] };
          if (sql.includes('app_api.read_viewing(')) return { rows: [{ detail: privateDetail }] };
          return { rows: [{ receipt: result }] };
        },
      });
    },
  };
  return {
    calls,
    contexts,
    service: createApiService({
      database,
      tenantId: tenant,
      privacyNoticeVersion: 'synthetic-v1',
      verifyAuthorization: async (request) => {
        if (request.headers.get('authorization') !== 'Bearer synthetic')
          throw new Error('PRIVATE AUTH');
        return { actorId: actor };
      },
    }),
  };
}
const req = (path, { method = 'GET', value, raw, authorization = 'Bearer synthetic' } = {}) =>
  new Request('https://synthetic.invalid' + path, {
    method,
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(value !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(value !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(value) } : {}),
  });
const phone = {
  operationId: operation,
  expectedVersion: 2,
  slot,
  channel: 'phone',
  agreedAt: '2026-10-13T19:00:00.000Z',
  notes: '  Synthetic phone agreement.  ',
};
const confirmed = {
  ...receipt,
  kind: 'confirm',
  expectedVersion: '2',
  observedVersion: '2',
  request: { slot, channel: 'phone', agreedAt: phone.agreedAt, notes: phone.notes },
  result: {
    ...schedule,
    status: 'confirmed',
    version: '3',
    proposedSlot: slot,
    agreement: { channel: 'phone', agreedAt: phone.agreedAt, notes: phone.notes },
  },
};
const ending = {
  operationId: operation,
  expectedVersion: 2,
  reason: '  Synthetic ending reason.\nExact original.  ',
};
const cancelled = {
  ...receipt,
  kind: 'cancel',
  expectedVersion: '2',
  observedVersion: '2',
  request: { reason: ending.reason },
  result: {
    ...schedule,
    status: 'cancelled',
    version: '3',
    proposedSlot: slot,
    termination: {
      kind: 'cancel',
      fromStatus: 'proposed',
      reason: ending.reason,
      endedAt: time,
      previousUpdatedAt: '2026-10-13T18:00:00.000Z',
    },
  },
};
const movedCommand = {
  operationId: operation,
  expectedVersion: 3,
  slot,
  reason: '  Synthetic change of agreed time.  ',
};
const moved = {
  ...receipt,
  kind: 'reschedule',
  expectedVersion: '3',
  observedVersion: '3',
  request: { slot, reason: movedCommand.reason },
  result: {
    ...schedule,
    status: 'proposed',
    version: '4',
    proposedSlot: slot,
    cycle: {
      number: '2',
      proposalVersion: '4',
      proposedAt: time,
      reason: movedCommand.reason,
      previousStatus: 'confirmed',
      previousUpdatedAt: '2026-10-13T19:00:00.000Z',
    },
  },
};
test('reschedule route binds exact selected version,new slot,reason and verified server actor', async () => {
  const f = fixture({ result: moved }),
    response = await f.service(
      req(base + `/viewings/${viewing}/reschedules`, { method: 'POST', value: movedCommand }),
    );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), moved);
  assert.deepEqual(f.calls.find((x) => x.sql.includes('reschedule_viewing')).args, [
    enquiry,
    viewing,
    operation,
    '3',
    JSON.stringify(slot),
    movedCommand.reason,
  ]);
  assert.equal(f.contexts[0].actorId, actor);
  assert.deepEqual(
    await (await f.service(req(base + '/viewing-operations/' + operation))).json(),
    moved,
  );
});
test('reschedule input refuses caller cycles,agreement,authority,duplicate facts and unsafe raw versions before storage', async () => {
  const path = base + `/viewings/${viewing}/reschedules`;
  for (const patch of [
    { actorId: actor },
    { cycle: { number: '2' } },
    { agreement: phone },
    { reason: ' ' },
    { expectedVersion: '3' },
  ]) {
    const f = fixture();
    assert.equal(
      (await f.service(req(path, { method: 'POST', value: { ...movedCommand, ...patch } }))).status,
      400,
    );
    assert.equal(f.contexts.length, 0);
  }
  for (const raw of [
    JSON.stringify(movedCommand).replace('"expectedVersion":3', '"expectedVersion":3e0'),
    JSON.stringify(movedCommand).replace(
      '"expectedVersion":3',
      '"expectedVersion":3.00000000000000001',
    ),
    JSON.stringify(movedCommand).replace('"reason":', '"reason":"duplicate","reason":'),
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(path, { method: 'POST', raw }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  assert.equal(
    (
      await fixture().service(
        req(path + '?actorId=foreign', { method: 'POST', value: movedCommand }),
      )
    ).status,
    400,
  );
  assert.equal((await fixture().service(req(path))).status, 405);
});
test('reschedule reply cannot claim changed private facts,forged actor or active transferred agreement', async () => {
  const path = base + `/viewings/${viewing}/reschedules`;
  for (const result of [
    { ...moved, actorId: id(99) },
    { ...moved, request: { ...moved.request, reason: 'changed' } },
    { ...moved, result: { ...moved.result, agreement: confirmed.result.agreement } },
  ])
    assert.equal(
      (await fixture({ result }).service(req(path, { method: 'POST', value: movedCommand })))
        .status,
      503,
    );
  assert.equal(
    (
      await fixture({ role: 'customer' }).service(
        req(path, { method: 'POST', value: movedCommand }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture({
        privateDetail: { ...detail, createdAt: '2026-10-13T17:00:00.000Z', schedule: moved.result },
      }).service(req(base + `/viewings/${viewing}`))
    ).status,
    200,
  );
});
test('viewing history route fixes verified context and bounded SQL while exposing saved states only', async () => {
  const page = {
      items: [{ kind: 'request', actorId: id(99), recordedAt: time, schedule }],
      limit: 25,
      truncated: false,
      currentVersion: '1',
    },
    f = fixture({ page }),
    response = await f.service(req(base + `/viewings/${viewing}/history`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), page);
  assert.deepEqual(f.calls.find((x) => x.sql.includes('read_viewing_history')).args, [
    enquiry,
    viewing,
    25,
  ]);
  assert.equal(f.contexts[0].actorId, actor);
  for (const query of ['?limit=26', '?limit=01', '?limit=1&limit=1', '?actorId=foreign']) {
    const g = fixture({ page });
    assert.equal((await g.service(req(base + `/viewings/${viewing}/history` + query))).status, 400);
    assert.equal(g.contexts.length, 0);
  }
  assert.equal(
    (await f.service(req(base + `/viewings/${viewing}/history`, { method: 'POST', value: {} })))
      .status,
    405,
  );
});
test('viewing history rejects wrong target,private original fields,broken coverage and untrusted roles', async () => {
  const page = {
    items: [{ kind: 'request', actorId: actor, recordedAt: time, schedule }],
    limit: 25,
    truncated: false,
    currentVersion: '1',
  };
  for (const bad of [
    { ...page, currentVersion: '2' },
    { ...page, items: [{ ...page.items[0], operationId: operation }] },
    { ...page, items: [{ ...page.items[0], schedule: { ...schedule, enquiryId: id(99) } }] },
  ])
    assert.equal(
      (await fixture({ page: bad }).service(req(base + `/viewings/${viewing}/history`))).status,
      503,
    );
  assert.equal(
    (await fixture({ role: 'customer' }).service(req(base + `/viewings/${viewing}/history`)))
      .status,
    403,
  );
  assert.equal(
    (await fixture().service(req(base + `/viewings/${viewing}/history`, { authorization: null })))
      .status,
    401,
  );
});
test('terminal routes bind fixed kind and verified authority and recover original private receipts', async () => {
  for (const [kind, suffix, status] of [
    ['cancel', 'cancellations', 'cancelled'],
    ['decline', 'declines', 'declined'],
  ]) {
    const result = {
        ...cancelled,
        kind,
        result: {
          ...cancelled.result,
          status,
          termination: { ...cancelled.result.termination, kind },
        },
      },
      f = fixture({ result });
    const saved = await f.service(
      req(base + `/viewings/${viewing}/${suffix}`, { method: 'POST', value: ending }),
    );
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), result);
    assert.deepEqual(f.calls.find((x) => x.sql.includes('terminate_viewing')).args, [
      enquiry,
      viewing,
      operation,
      '2',
      kind,
      ending.reason,
    ]);
    assert.equal(f.contexts[0].actorId, actor);
    assert.deepEqual(
      await (await f.service(req(base + '/viewing-operations/' + operation))).json(),
      result,
    );
    assert.equal((await f.service(req(base + `/viewings/${viewing}/${suffix}`))).status, 405);
  }
});
test('terminal commands reject authority,unsafe numbers,duplicate reasons and overrides before storage', async () => {
  const path = base + `/viewings/${viewing}/cancellations`;
  for (const value of [
    { ...ending, actorId: actor },
    { ...ending, kind: 'decline' },
    { ...ending, reason: ' ' },
    { ...ending, reason: 'x'.repeat(1001) },
    { ...ending, expectedVersion: '2' },
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(path, { method: 'POST', value }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  for (const raw of [
    JSON.stringify(ending).replace('"expectedVersion":2', '"expectedVersion":2e0'),
    JSON.stringify(ending).replace('"expectedVersion":2', '"expectedVersion":2.00000000000000001'),
    JSON.stringify(ending).replace('"reason":', '"reason":"duplicate","reason":'),
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(path, { method: 'POST', raw }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  assert.equal(
    (await fixture().service(req(path + '?tenantId=foreign', { method: 'POST', value: ending })))
      .status,
    400,
  );
});
test('terminal receipts reject changed private facts and actors while historical detail keeps separate attribution', async () => {
  for (const result of [
    { ...cancelled, actorId: id(99) },
    { ...cancelled, request: { reason: 'changed' } },
    { ...cancelled, result: { ...cancelled.result, viewingId: id(99) } },
  ])
    assert.equal(
      (
        await fixture({ result }).service(
          req(base + `/viewings/${viewing}/cancellations`, { method: 'POST', value: ending }),
        )
      ).status,
      503,
    );
  const privateDetail = {
    ...detail,
    schedule: cancelled.result,
    createdAt: '2026-10-13T17:00:00.000Z',
    terminationRecord: { recordedById: actor },
  };
  assert.equal(
    (await fixture({ privateDetail }).service(req(base + '/viewings/' + viewing))).status,
    200,
  );
  assert.equal(
    (
      await fixture({ role: 'customer' }).service(
        req(base + `/viewings/${viewing}/cancellations`, { method: 'POST', value: ending }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture({ result: { ...cancelled, operationId: id(99) } }).service(
        req(base + '/viewing-operations/' + operation),
      )
    ).status,
    503,
  );
});
test('phone confirmation route binds exact verified identity and source-free original SQL facts', async () => {
  const f = fixture({ result: confirmed }),
    result = await f.service(
      req(base + `/viewings/${viewing}/confirmations`, { method: 'POST', value: phone }),
    );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), confirmed);
  assert.deepEqual(f.calls.find((x) => x.sql.includes('confirm_viewing_phone')).args, [
    enquiry,
    viewing,
    operation,
    '2',
    JSON.stringify(slot),
    'phone',
    phone.agreedAt,
    phone.notes,
  ]);
  assert.equal(f.contexts[0].actorId, actor);
  assert.deepEqual(
    await (await f.service(req(base + '/viewing-operations/' + operation))).json(),
    confirmed,
  );
  assert.equal((await f.service(req(base + `/viewings/${viewing}/confirmations`))).status, 405);
});
test('phone confirmation refuses caller authority,unsupported agreement and unsafe integer tokens before transaction', async () => {
  const path = base + `/viewings/${viewing}/confirmations`;
  for (const value of [
    { ...phone, actorId: actor },
    { ...phone, tenantId: tenant },
    { ...phone, customerToken: 'secret' },
    { ...phone, channel: 'email' },
    { ...phone, agreedAt: null },
    { ...phone, expectedVersion: '2' },
    { ...phone, notes: ' ' },
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(path, { method: 'POST', value }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  for (const raw of [
    JSON.stringify(phone).replace('"expectedVersion":2', '"expectedVersion":2e0'),
    JSON.stringify(phone).replace('"expectedVersion":2', '"expectedVersion":2.00000000000000001'),
    JSON.stringify(phone).replace('"notes":', '"notes":"duplicate","notes":'),
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(path, { method: 'POST', raw }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  for (const query of ['?limit=1', '?actor=admin', '?tenantId=foreign'])
    assert.equal(
      (await fixture().service(req(path + query, { method: 'POST', value: phone }))).status,
      400,
    );
});
test('phone confirmation validates current detail metadata and rejects altered result or requester privately', async () => {
  const confirmedDetail = {
    ...detail,
    createdAt: '2026-10-13T17:00:00.000Z',
    schedule: confirmed.result,
    confirmation: { proposedAt: '2026-10-13T18:00:00.000Z', recordedAt: time, recordedById: actor },
  };
  assert.equal(
    (await fixture({ privateDetail: confirmedDetail }).service(req(base + '/viewings/' + viewing)))
      .status,
    200,
  );
  for (const result of [
    { ...confirmed, actorId: id(99) },
    { ...confirmed, request: { ...confirmed.request, notes: 'changed' } },
    {
      ...confirmed,
      result: {
        ...confirmed.result,
        agreement: { ...confirmed.result.agreement, notes: 'changed' },
      },
    },
  ])
    assert.equal(
      (
        await fixture({ result }).service(
          req(base + `/viewings/${viewing}/confirmations`, { method: 'POST', value: phone }),
        )
      ).status,
      503,
    );
  assert.equal(
    (
      await fixture({ result: { ...confirmed, operationId: id(99) } }).service(
        req(base + '/viewing-operations/' + operation),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await fixture({ role: 'customer' }).service(
        req(base + `/viewings/${viewing}/confirmations`, { method: 'POST', value: phone }),
      )
    ).status,
    403,
  );
});
test('viewing routes bind fixed verified authority,original facts and exact typed SQL arguments', async () => {
  const f = fixture(),
    saved = await f.service(req(base + '/viewings', { method: 'POST', value: body }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), receipt);
  assert.equal(f.contexts[0].tenantId, tenant);
  assert.equal(f.contexts[0].actorId, actor);
  const query = f.calls.find((c) => c.sql.includes('execute_viewing_operation'));
  assert.deepEqual(query.args, [
    enquiry,
    null,
    operation,
    '2',
    'request',
    listing,
    JSON.stringify([slot]),
    body.notes,
    null,
  ]);
  assert.equal((await f.service(req(base + '/viewing-operations/' + operation))).status, 200);
  assert.equal((await f.service(req(base + '/viewings/' + viewing))).status, 200);
  assert.equal((await f.service(req(base + '/viewings'))).status, 200);
});
test('viewing input rejects authority,extra facts,rounded versions,duplicates and query overrides before dispatch', async () => {
  for (const value of [
    { ...body, actorId: actor },
    { ...body, tenantId: tenant },
    { ...body, confirmed: true },
    { ...body, expectedEnquiryVersion: '2' },
    { ...body, preferredSlots: [{ ...slot, timeZone: null }] },
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(base + '/viewings', { method: 'POST', value }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  for (const raw of [
    JSON.stringify(body).replace('"expectedEnquiryVersion":2', '"expectedEnquiryVersion":2e0'),
    JSON.stringify(body).replace(
      '"expectedEnquiryVersion":2',
      '"expectedEnquiryVersion":2.00000000000000001',
    ),
    JSON.stringify(body).replace('"notes":', '"notes":"duplicate","notes":'),
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(base + '/viewings', { method: 'POST', raw }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  for (const suffix of [
    '/viewings?tenantId=foreign',
    '/viewings?limit=26',
    '/viewings?limit=01',
    '/viewings?limit=1&limit=1',
    `/viewings/${viewing}?limit=1`,
  ]) {
    const f = fixture();
    assert.equal((await f.service(req(base + suffix))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
});
test('proposal route accepts only source-free first-proposal command and verified result', async () => {
  const result = {
      ...receipt,
      kind: 'propose',
      expectedVersion: '1',
      observedVersion: '1',
      request: { slot },
      result: { ...schedule, version: '2', status: 'proposed', proposedSlot: slot },
    },
    f = fixture({ result });
  const response = await f.service(
    req(base + `/viewings/${viewing}/proposals`, {
      method: 'POST',
      value: { operationId: operation, expectedVersion: 1, slot },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.find((c) => c.sql.includes('execute_viewing_operation')).args, [
    enquiry,
    viewing,
    operation,
    '1',
    'propose',
    null,
    null,
    null,
    JSON.stringify(slot),
  ]);
  for (const [path, method] of [
    [`/viewings/${viewing}`, 'POST'],
    [`/viewings/${viewing}/proposals`, 'GET'],
    [`/viewing-operations/${operation}`, 'POST'],
    ['/viewings', 'PUT'],
  ])
    assert.equal((await f.service(req(base + path, { method }))).status, 405);
});
test('malformed stored facts and wrong receipt actor/operation return sanitized service failure', async () => {
  for (const result of [
    { ...receipt, actorId: id(9) },
    { ...receipt, request: { ...receipt.request, notes: 'changed' } },
    { ...receipt, private: 'SECRET' },
    { ...receipt, result: { ...schedule, enquiryId: id(9) } },
  ]) {
    const f = fixture({ result }),
      response = await f.service(req(base + '/viewings', { method: 'POST', value: body }));
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('SECRET'), false);
  }
  const wrong = fixture({ result: { ...receipt, operationId: id(9) } });
  assert.equal((await wrong.service(req(base + '/viewing-operations/' + operation))).status, 503);
  const privateFailure = fixture({ failure: { code: 'P0002', message: 'PRIVATE SQL' } }),
    response = await privateFailure.service(req(base + '/viewings'));
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes('PRIVATE'), false);
  const customer = fixture({ role: 'customer' });
  assert.equal((await customer.service(req(base + '/viewings'))).status, 403);
  assert.equal(
    (await fixture().service(req(base + '/viewings', { authorization: null }))).status,
    401,
  );
});

test('private outcome detail feed and history reads retain saved occurrence and earlier confirmation evidence', async () => {
  const o = outcomeFixture({
    enquiry,
    viewing,
    listing,
    actor,
    operation,
    later: true,
    kind: 'no_show',
  });
  for (const [suffix, override, expected] of [
    [`/viewings/${viewing}`, { privateDetail: o.detail }, o.detail],
    [
      '/viewings?limit=25',
      { page: { items: [o.detail], limit: 25, truncated: false } },
      { items: [o.detail], limit: 25, truncated: false },
    ],
    [`/viewings/${viewing}/history?limit=25`, { page: o.history }, o.history],
  ]) {
    const f = fixture(override),
      response = await f.service(req(base + suffix));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.equal(f.contexts[0].actorId, actor);
    assert.ok(f.calls.every((c) => !c.sql.includes('record_viewing_outcome')));
  }
});
test('protected outcome reads reject altered saved or confirmation clocks and malformed outcome staff metadata', async () => {
  const o = outcomeFixture({ enquiry, viewing, listing, actor, operation });
  for (const patch of [
    { updatedAt: o.detail.confirmation.recordedAt },
    { confirmation: { ...o.detail.confirmation, recordedAt: o.detail.updatedAt } },
    { outcomeRecord: { recordedById: actor, reason: 'Extra' } },
  ]) {
    const f = fixture({ privateDetail: { ...o.detail, ...patch } });
    assert.equal((await f.service(req(base + `/viewings/${viewing}`))).status, 503);
    assert.ok(f.calls.every((c) => !c.sql.includes('record_viewing_outcome')));
  }
  const page = structuredClone(o.history);
  page.items[0].schedule.agreement.notes = 'Changed evidence';
  const f = fixture({ page });
  assert.equal((await f.service(req(base + `/viewings/${viewing}/history?limit=25`))).status, 503);
});

test('outcome API fixes route kind, typed SQL arguments and original receipt GET without replay writes', async () => {
  for (const kind of ['complete', 'no_show']) {
    const o = outcomeFixture({ enquiry, viewing, listing, actor, operation, kind }),
      f = fixture({ result: o.receipt }),
      path = base + `/viewings/${viewing}/${kind === 'complete' ? 'completions' : 'no-shows'}`,
      body = { ...o.command, expectedVersion: 3 };
    assert.deepEqual(
      await (await f.service(req(path, { method: 'POST', value: body }))).json(),
      o.receipt,
    );
    assert.deepEqual(f.calls.find((x) => x.sql.includes('record_viewing_outcome')).args, [
      enquiry,
      viewing,
      operation,
      '3',
      kind,
      o.command.occurredAt,
      o.command.reason,
    ]);
    f.calls.length = 0;
    assert.deepEqual(
      await (await f.service(req(base + '/viewing-operations/' + operation))).json(),
      o.receipt,
    );
    assert.ok(f.calls.some((x) => x.sql.includes('read_viewing_operation')));
    assert.ok(f.calls.every((x) => !x.sql.includes('record_viewing_outcome')));
  }
});
test('outcome API refuses caller authority kind and ambiguous or oversized bodies before outcome storage', async () => {
  const o = outcomeFixture({ enquiry, viewing, listing, actor, operation }),
    path = base + `/viewings/${viewing}/completions`,
    body = { ...o.command, expectedVersion: 3 };
  for (const raw of [
    JSON.stringify({ ...body, actorId: actor }),
    JSON.stringify({ ...body, kind: 'no_show' }),
    JSON.stringify(body).replace('"expectedVersion":3', '"expectedVersion":3e0'),
    JSON.stringify(body).replace('"reason":', '"reason":"duplicate","reason":'),
    ' '.repeat(16385),
  ]) {
    const f = fixture({ result: o.receipt });
    assert.equal(
      (await f.service(req(path, { method: 'POST', raw }))).status,
      raw.length > 16384 ? 413 : 400,
    );
    assert.ok(f.calls.every((c) => !c.sql.includes('record_viewing_outcome')));
  }
  const f = fixture({ result: o.receipt });
  assert.equal((await f.service(req(path))).status, 405);
  assert.equal(
    (await f.service(req(path + '?actor=other', { method: 'POST', value: body }))).status,
    400,
  );
});
test('outcome API rejects altered kind original facts actor and successful evidence projections', async () => {
  const o = outcomeFixture({ enquiry, viewing, listing, actor, operation }),
    path = base + `/viewings/${viewing}/completions`;
  for (const value of [
    { ...o.receipt, actorId: listing },
    { ...o.receipt, kind: 'no_show' },
    { ...o.receipt, request: { ...o.receipt.request, reason: 'Changed' } },
    {
      ...o.receipt,
      result: {
        ...o.schedule,
        outcome: { ...o.schedule.outcome, recordedAt: '2020-01-01T12:00:00.000Z' },
      },
    },
  ]) {
    const f = fixture({ result: value });
    assert.equal(
      (await f.service(req(path, { method: 'POST', value: { ...o.command, expectedVersion: 3 } })))
        .status,
      503,
    );
  }
  const f = fixture({ result: { ...o.receipt, actorId: listing } });
  assert.equal((await f.service(req(base + '/viewing-operations/' + operation))).status, 503);
});
