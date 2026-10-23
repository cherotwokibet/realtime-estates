import test from 'node:test';
import assert from 'node:assert/strict';
import { readReferenceModerationScreen } from '../dist/tests/lib/reference-moderation-screen.js';
import { review, catalogue, id } from '../test-helpers/reference-moderation-fixture.mjs';
const fixture = () => ({ review: review(), catalogue: catalogue() });

const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
  STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'a.b.c',
  STAFF_PREVIEW_INSTANCE: id(9),
};
test('review loader derives current company/actor and historical catalogue without browser credentials', async () => {
  const f = fixture(),
    calls = [];
  const context = {
    policy: 'synthetic-reference-context-v1',
    review: f.review,
    catalogue: f.catalogue,
  };
  const transport = async (url, init) => {
    calls.push({ url, init });
    return Response.json(
      url.endsWith('/reference-session')
        ? { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(10) }
        : context,
    );
  };
  const result = await readReferenceModerationScreen(
    f.review.listingId,
    '1',
    f.review.revisionVersion,
    env,
    transport,
  );
  assert.deepEqual(result.context, context);
  assert.deepEqual(result.scope, {
    instanceId: id(9),
    tenantId: id(1),
    actorId: id(10),
    listingId: f.review.listingId,
    revision: 1,
  });
  assert.equal(calls.length, 2);
  assert.ok(
    calls[1].url.endsWith(
      `/reviews/${f.review.listingId}/reference-revisions/1/${f.review.revisionVersion}/context`,
    ),
  );
  assert.ok(calls.every((c) => c.init.method === 'GET' && c.init.body === undefined));
  assert.ok(!JSON.stringify(result).includes('a.b.c'));
  assert.ok(Object.isFrozen(result.scope) && Object.isFrozen(result.context.review));
});
test('review loader refuses disabled modes and noncanonical targets before transport', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    throw Error();
  };
  for (const altered of [
    { ...env, STAFF_PREVIEW_REFERENCE_MODERATION: undefined },
    { ...env, STAFF_PREVIEW_REFERENCE: 'off' },
    { ...env, NODE_ENV: 'production' },
    { ...env, STAFF_PREVIEW_API_ORIGIN: 'https://example.com' },
  ])
    await assert.rejects(() =>
      readReferenceModerationScreen(id(100), '1', '3', altered, transport),
    );
  for (const [listing, revision, version] of [
    [id(100), '01', '3'],
    [id(100), '2147483648', '3'],
    [id(100), '1', '03'],
    [id(100), '1', '9007199254740992'],
    ['not-an-id', '1', '3'],
  ])
    await assert.rejects(() =>
      readReferenceModerationScreen(listing, revision, version, env, transport),
    );
  assert.equal(calls, 0);
});
test('review loader never returns malformed, nonpending, renamed or denied review data', async () => {
  const f = fixture();
  for (const kind of ['draft', 'renamed', 'wrong', 'denied']) {
    const c = structuredClone({
      policy: 'synthetic-reference-context-v1',
      review: f.review,
      catalogue: f.catalogue,
    });
    if (kind === 'draft') c.review.state = 'draft';
    if (kind === 'renamed') c.catalogue.version = '2';
    if (kind === 'wrong') c.review.listingId = id(999);
    const transport = async (url) =>
      Response.json(
        url.endsWith('/reference-session')
          ? { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(10) }
          : kind === 'denied'
            ? { error: { code: 'FORBIDDEN', message: 'Denied' }, requestId: id(900) }
            : c,
        {
          status: !url.endsWith('/reference-session') && kind === 'denied' ? 403 : 200,
          headers: { 'x-request-id': id(900) },
        },
      );
    await assert.rejects(() =>
      readReferenceModerationScreen(
        f.review.listingId,
        '1',
        f.review.revisionVersion,
        env,
        transport,
      ),
    );
  }
});
test('a missing or advanced pending row leaves only a current-session recovery shell', async () => {
  for (const status of [404, 409]) {
    const transport = async (url) =>
      Response.json(
        url.endsWith('/reference-session')
          ? { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(10) }
          : {
              error: { code: status === 404 ? 'NOT_FOUND' : 'CONFLICT', message: 'Unavailable' },
              requestId: id(900),
            },
        {
          status: url.endsWith('/reference-session') ? 200 : status,
          headers: { 'x-request-id': id(900) },
        },
      );
    const screen = await readReferenceModerationScreen(id(100), '1', '3', env, transport);
    assert.equal(screen.context, null);
    assert.equal(screen.scope.actorId, id(10));
    assert.ok(!JSON.stringify(screen).includes('a.b.c'));
  }
});
