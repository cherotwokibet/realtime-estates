import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import { readListingVideoScreen } from '../dist/tests/lib/listing-video-screen.js';
import { listingVideoRequest } from '../dist/tests/lib/listing-video-server.js';
import { createListingVideoClient } from '../dist/tests/lib/listing-video-client.js';
import { videoSession, videoAttempt } from '../dist/tests/lib/listing-video-session.js';
const instance = '00000000-0000-4000-8000-000000000990';
const modes = {
  port: 0,
  actor: 'agent',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  listingVideoMode: 'synthetic-private-listing-video-v1',
};
const environment = (p) => ({
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: modes.referenceDraftMode,
  STAFF_PREVIEW_VIDEO: modes.listingVideoMode,
  STAFF_PREVIEW_API_ORIGIN: p.origin,
  STAFF_PREVIEW_TOKEN: p.bearerToken,
  STAFF_PREVIEW_INSTANCE: instance,
});
const adapter = (env, transport) => async (url, init) =>
  listingVideoRequest(
    new Request('http://127.0.0.1:3132' + url, {
      ...init,
      headers: { ...init.headers, Host: '127.0.0.1:3132', Origin: 'http://127.0.0.1:3132' },
    }),
    env,
    transport,
  );
async function adopt(p) {
  const api = new RealtorApiClient({
      baseUrl: p.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic',
    }),
    opt = { bearerToken: p.bearerToken };
  const w = await api.getStaffDraftWorkspaceV2(p.listingId, 1, opt),
    cat = await api.getSyntheticReferenceCatalogueV3('current', opt);
  await api.saveSyntheticReferenceDraftV3(
    {
      policy: 'synthetic-reference-draft-v1',
      operationId: randomUUID(),
      listingId: p.listingId,
      revision: 1,
      expectedVersion: w.draft.version,
      content: normalizeStaffDraftContentV2({
        ...w.draft.content,
        locality: null,
        location: { county: null, town: null, area: null },
      }),
      selection: {
        catalogueVersion: cat.version,
        location: { countyId: null, localityId: null, neighbourhoodId: null },
        amenityIds: [],
      },
    },
    cat,
    '00000000-0000-4000-8000-000000000011',
    opt,
  );
}
const store = () => ({
  data: new Map(),
  getItem(k) {
    return this.data.get(k) ?? null;
  },
  setItem(k, v) {
    this.data.set(k, v);
  },
  removeItem(k) {
    this.data.delete(k);
  },
});
test('author loader/BFF/client/retained model connect signed video save, lost reply, reload, GET original and fresh removal', async () => {
  const p = await startStaffPreview({ ...modes, listingVideoReplyFault: 'invalid-first-video-v1' });
  try {
    await adopt(p);
    const env = environment(p),
      screen = await readListingVideoScreen(p.listingId, '1', env),
      client = createListingVideoClient(screen.scope, adapter(env)),
      st = store(),
      command = {
        policy: 'synthetic-listing-video-command-v1',
        operationId: randomUUID(),
        listingId: p.listingId,
        revision: 1,
        expectedVersion: screen.state.version,
        video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic author tour' },
      };
    const a = videoAttempt(st, screen.scope, client, command);
    await assert.rejects(a.send(), (e) => e.submissionUncertain);
    assert.equal(a.status, 'uncertain');
    const changed = await readListingVideoScreen(p.listingId, '1', env);
    assert.equal(changed.state.video.title, command.video.title);
    assert.equal(changed.state.version, String(BigInt(command.expectedVersion) + 1n));
    const b = videoAttempt(
      st,
      screen.scope,
      client,
      videoSession(st, screen.scope).load().command,
      true,
    );
    await b.recover();
    assert.deepEqual(b.receipt.command, command);
    assert.equal(b.status, 'resolved');
    b.clear();
    const clear = {
        ...command,
        operationId: randomUUID(),
        expectedVersion: changed.state.version,
        video: null,
      },
      c = videoAttempt(st, changed.scope, client, clear);
    await c.send();
    c.clear();
    assert.equal((await readListingVideoScreen(p.listingId, '1', env)).state.video, null);
    const wrong = { ...env, STAFF_PREVIEW_REFERENCE: undefined };
    await assert.rejects(() => readListingVideoScreen(p.listingId, '1', wrong));
  } finally {
    await p.close();
  }
});
test('post-save access loss stays uncertain while all BFF reads and originals use current signed scope', async () => {
  const p = await startStaffPreview(modes);
  try {
    await adopt(p);
    const env = environment(p),
      screen = await readListingVideoScreen(p.listingId, '1', env),
      seen = [];
    let written = false;
    const upstream = async (url, init) => {
      seen.push({ url: String(url), method: init.method });
      const headers = new Headers(init.headers);
      if (written && String(url).endsWith('/v2/staff/session'))
        headers.set('Authorization', 'Bearer ' + p.bearerToken + 'x');
      const r = await fetch(url, { ...init, headers });
      if (init.method === 'POST' && String(url).includes('/video-operations/')) written = true;
      return r;
    };
    const c = {
      policy: 'synthetic-listing-video-command-v1',
      operationId: randomUUID(),
      listingId: p.listingId,
      revision: 1,
      expectedVersion: screen.state.version,
      video: null,
    };
    const client = createListingVideoClient(screen.scope, adapter(env, upstream)),
      st = store(),
      a = videoAttempt(st, screen.scope, client, c);
    await assert.rejects(a.send(), (e) => e.status === 401 && e.submissionUncertain);
    assert.equal(a.status, 'uncertain');
    assert.throws(() => a.clear());
    assert.equal(seen.filter((x) => x.method === 'POST').length, 1);
    const recovered = await createListingVideoClient(screen.scope, adapter(env)).recover(c);
    assert.deepEqual(recovered.command, c);
    const request = new Request(
      `http://127.0.0.1:3132/api/staff/listings/${p.listingId}/video-operations/${c.operationId}`,
      {
        method: 'POST',
        headers: {
          Host: '127.0.0.1:3132',
          Origin: 'http://127.0.0.1:3132',
          'Content-Type': 'application/json',
          'X-Preview-Instance': instance,
          'X-Reference-Actor': randomUUID(),
          'X-Reference-Tenant': screen.scope.tenantId,
        },
        body: JSON.stringify(c),
      },
    );
    const r = await listingVideoRequest(request, env);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).submissionUncertain, false);
  } finally {
    await p.close();
  }
});
