import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { startCustomerPreview } from './customer-preview.mjs';
import { createMobileCustomerSession } from '../../mobile/src/customer-session.ts';
import { loadMobileReferenceCatalogue } from '../../mobile/src/reference-catalogue.ts';
import { requestSyntheticCustomerGrant } from '../../mobile/src/synthetic-customer-sign-in.ts';

test('owned native sign-in connects approved stock, recovery, removal and two isolated customers', async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    for (const tenantSlug of ['realtime-estates', 'sample-homes']) {
      const preview = await startCustomerPreview({
        tenantSlug,
        mobileMode: 'synthetic-mobile-customer-v1',
        replyFault: 'lost-first-favourite-result-v1',
      });
      const config = {
        mode: 'synthetic-reference-public-v1',
        tenantSlug,
        apiOrigin: preview.origin,
        allowLoopbackHttp: true,
      };
      const methods = [];
      const transport = (url, options) => {
        methods.push([new URL(url).pathname, options.method]);
        return fetch(url, options);
      };
      const session = createMobileCustomerSession(
        {
          mode: 'runtime-customer-v1',
          tenantId: preview.tenantId,
          apiOrigin: preview.origin,
          allowLoopbackHttp: true,
        },
        transport,
      );
      const grant = (persona) =>
        requestSyntheticCustomerGrant(
          preview.origin,
          preview.tenantId,
          persona,
          new AbortController().signal,
          transport,
        );
      try {
        const page = await loadMobileReferenceCatalogue(config, {
          search: { offset: 0, limit: 24 },
        });
        assert.equal(page.status, 'ready');
        assert(page.items.some(({ property }) => property.id === preview.listingId));
        const signInUrl = preview.origin + '/dev/mobile-customer/session';
        for (const headers of [
          { 'X-Realtor-Preview-Customer': 'admin' },
          { 'X-Realtor-Preview-Customer': 'a', Origin: 'http://foreign.invalid' },
          { 'X-Realtor-Preview-Customer': 'a', Cookie: 'unexpected=1' },
        ]) {
          const refused = await fetch(signInUrl, { method: 'POST', headers });
          assert.equal(refused.status, 404);
          assert.equal('bearerToken' in (await refused.json()), false);
        }
        const aliasStatus = await new Promise((resolve, reject) => {
          const call = request(
            signInUrl,
            {
              method: 'POST',
              headers: {
                'X-Realtor-Preview-Customer': 'a',
                Host: 'localhost:' + new URL(preview.origin).port,
              },
            },
            (reply) => {
              reply.resume();
              resolve(reply.statusCode);
            },
          );
          call.once('error', reject);
          call.end();
        });
        assert.equal(aliasStatus, 404);
        assert.equal((await fetch(signInUrl)).status, 404);
        assert.equal(
          (
            await fetch(signInUrl, {
              method: 'POST',
              headers: { 'X-Realtor-Preview-Customer': 'a' },
              body: 'unexpected',
            })
          ).status,
          404,
        );
        const a = await grant('a');
        assert(a);
        assert.equal(await session.activate(a), true);
        const listingId = preview.listingId;
        const fresh = await session.favourite(listingId);
        assert.equal(fresh.saved, false);
        const command = {
          policy: 'customer-favourite-command-v1',
          listingId,
          operationId: randomUUID(),
          expectedVersion: fresh.version,
          saved: true,
        };
        assert.equal(await session.save(command), false);
        assert.equal(session.snapshot().phase, 'uncertain');
        assert.equal(await session.recover(), true);
        assert.equal(session.settle(), true);
        assert.deepEqual(
          (await session.list()).items.map((item) => item.listingId),
          [listingId],
        );
        assert.deepEqual(
          methods
            .filter(([path]) => path.endsWith(command.operationId))
            .map(([, method]) => method),
          ['POST', 'GET'],
        );
        assert.equal(await session.activate(await grant('b')), true);
        assert.deepEqual((await session.list()).items, []);
        assert.equal(await session.activate(await grant('a')), true);
        const saved = await session.favourite(listingId);
        assert.equal(
          await session.save({
            ...command,
            operationId: randomUUID(),
            expectedVersion: saved.version,
            saved: false,
          }),
          true,
        );
        assert.equal(session.settle(), true);
        assert.deepEqual((await session.list()).items, []);
        session.clear();
        assert.equal(session.snapshot().status, 'signed_out');
      } finally {
        session.clear();
        await preview.close();
      }
    }
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
