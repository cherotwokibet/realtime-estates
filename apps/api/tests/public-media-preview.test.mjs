import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentPublicMediaPreviewApi as factory } from '../dist/media-preview.js';
import {
  fixture,
  facts,
  bytes,
  sqlError,
  id,
  TENANT,
  LISTING,
  JOB,
  OUTPUT,
} from './media-boundary-fixtures.mjs';
const route = `http://127.0.0.1/v2/public/listings/${LISTING}/revisions/1/photos/${JOB}/${OUTPUT}.webp`;
const key = `synthetic/${TENANT}/${JOB}/${OUTPUT}.webp`;
const publicFacts = () => ({
  ...facts(),
  kind: 'public_media_preview',
  state: 'approved',
  actorRole: 'guest',
  assignedAgentId: null,
});
const setup = (options = {}) =>
  fixture({ factory, actor: null, reads: [publicFacts(), publicFacts()], ...options });
const request = (url = route, headers = {}) => new Request(url, { headers });

test('anonymous public delivery uses null actor, exact public key, matching sealed bytes and two current SQL reads', async () => {
  const f = setup();
  const response = await f.api.handle(request());
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes());
  assert.equal(f.calls.verify, 0);
  assert.equal(f.calls.reads, 2);
  for (const q of f.calls.sql) {
    assert.match(q.sql, /read_public_media_preview/);
    assert.deepEqual(q.args, [LISTING, 1, key]);
  }
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('set-cookie'), null);
});
test('draft/reviewer/private facts cannot authorize public storage IO', async () => {
  for (const replacement of [
    facts(),
    { ...publicFacts(), kind: 'review_media_preview', state: 'pending', actorRole: 'admin' },
    { ...publicFacts(), assignedAgentId: id(88) },
    { ...publicFacts(), tenantId: id(99) },
    { ...publicFacts(), state: 'draft' },
    { ...publicFacts(), privateAddress: 'never disclose' },
  ]) {
    const f = setup({ reads: [replacement] });
    const response = await f.api.handle(request());
    assert.equal(response.status, 503);
    assert.equal(f.calls.requests, 0);
    assert.equal(f.calls.outputs, 0);
    assert.equal(f.calls.verify, 0);
  }
});
test('public SQL denial stops before IO and after-IO pause/revision or provenance change never returns bytes', async () => {
  const first = setup({ reads: [sqlError('P0002')] });
  assert.equal((await first.api.handle(request())).status, 404);
  assert.equal(first.calls.outputs, 0);
  for (const after of [
    sqlError('P0002'),
    { ...publicFacts(), version: '4' },
    { ...publicFacts(), mediaId: id(77) },
  ]) {
    const f = setup({ reads: [publicFacts(), after] });
    const r = await f.api.handle(request());
    assert.notEqual(r.status, 200);
    assert.equal(f.calls.outputs, 1);
    assert.equal(r.headers.get('content-type'), 'application/json');
    assert.equal((await r.text()).includes('PRIVATE'), false);
  }
});
test('public job/output route cannot select crossed stored provenance or another company', async () => {
  for (const url of [route.replace(JOB, id(888)), route.replace(OUTPUT, id(889))]) {
    const f = setup();
    assert.equal((await f.api.handle(request(url))).status, 503);
    assert.equal(f.calls.requests, 0);
  }
});
test('public request credentials, cookies, versions, range/conditional/query/body and private routes fail before any authority IO', async () => {
  for (const headers of [
    { authorization: 'Bearer ignored' },
    { cookie: 'session=private' },
    { 'x-revision-version': '3' },
    { range: 'bytes=0-1' },
    { 'if-none-match': 'anything' },
    { 'content-length': '0' },
    { origin: 'https://foreign.invalid' },
  ]) {
    const f = setup();
    assert.notEqual((await f.api.handle(request(route, headers))).status, 200);
    assert.equal(f.calls.reads, 0);
    assert.equal(f.calls.verify, 0);
  }
  for (const url of [
    route + '?tenant=' + TENANT,
    route.replace('/revisions/1/', '/revisions/01/'),
    route.replace('/revisions/1/', '/revisions/2147483648/'),
    route.replace('/v2/public/', '/v2/staff/'),
    route.replace('127.0.0.1', 'foreign.invalid'),
  ]) {
    const f = setup();
    assert.notEqual((await f.api.handle(request(url))).status, 200);
    assert.equal(f.calls.reads, 0);
  }
});
test('public corrupt or unsealed storage returns safe failure, never raw provenance', async () => {
  for (const options of [
    { sealed: sqlError('unknown') },
    { output: sqlError('missing') },
    { original: sqlError('unknown') },
    { output: { receipt: {}, data: Buffer.from('corrupt') } },
  ]) {
    const f = setup(options);
    const r = await f.api.handle(request());
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('content-type'), 'application/json');
    assert.equal((await r.text()).includes('PRIVATE'), false);
  }
});
