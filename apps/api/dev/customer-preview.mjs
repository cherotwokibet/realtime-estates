/** Owned synthetic customer fixture. Keys/tokens live only in memory and child server environment. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  fixture,
  publish,
  asActor,
  T,
  OTHER,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import { createApiService } from '../dist/service.js';
import { createIdentityVerifier, parseBearerHeader } from '../dist/auth.js';
import { createDevelopmentServer } from '../dist/http.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const listen = (s) =>
  new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + s.address().port));
  });
const stop = (s) =>
  new Promise((resolve) => {
    s.closeAllConnections();
    s.close(resolve);
  });
export async function startCustomerPreview({ tenantSlug = 'realtime-estates', replyFault } = {}) {
  if (
    process.env.NODE_ENV !== 'development' ||
    !['realtime-estates', 'sample-homes'].includes(tenantSlug) ||
    (replyFault !== undefined && replyFault !== 'lost-first-favourite-result-v1')
  )
    throw Error('Explicit supported development customer preview required.');
  const db = await fixture(),
    servers = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const s of servers.reverse()) await stop(s);
    await db.close();
  };
  try {
    await publish(db);
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/customer-favourites.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$4,'customer'),($3,$2,'customer')",
      [T, id(14), OTHER, id(13)],
    );
    let foreignSavedFixture = false;
    if (tenantSlug === 'sample-homes') {
      const saved = await asActor(db, T, id(13), () =>
        db.query('SELECT app_api.set_customer_favourite($1,$2,0,true) AS receipt', [
          id(42000),
          LISTING,
        ]),
      );
      foreignSavedFixture = saved.rows[0].receipt.saved === true;
      if (!foreignSavedFixture) throw Error('Synthetic positive isolation fixture failed.');
    }
    const tenantId = tenantSlug === 'sample-homes' ? OTHER : T;
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const kid = 'synthetic-customer-preview-v1',
      jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
    const jwks = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/.well-known/jwks.json') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    servers.push(jwks);
    const issuer = await listen(jwks);
    const verify = createIdentityVerifier({
      issuer,
      audience: 'synthetic-customer-preview-v1',
      jwksUrl: issuer + '/.well-known/jwks.json',
      allowLoopbackHttpForTests: true,
    });
    const issued = Math.floor(Date.now() / 1000),
      expiresAt = new Date((issued + 900) * 1000).toISOString();
    const users = [];
    for (const [n, label] of [
      [13, 'Synthetic Customer A'],
      [14, 'Synthetic Customer B'],
    ])
      users.push({
        id: id(n),
        label,
        bearerToken: await new SignJWT({ synthetic: true })
          .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
          .setIssuer(issuer)
          .setAudience('synthetic-customer-preview-v1')
          .setSubject(id(n))
          .setIssuedAt(issued)
          .setExpirationTime(issued + 900)
          .sign(privateKey),
      });
    const service = createApiService({
      tenantId,
      privacyNoticeVersion: 'synthetic-customer-preview-v1',
      customerFavouritesMode: 'synthetic-customer-favourites-v1',
      verifyAuthorization: (r) =>
        verify(parseBearerHeader(r.headers.get('authorization') ?? undefined)),
      database: {
        transaction: ({ tenantId, actorId }, fn) => asActor(db, tenantId, actorId, () => fn(db)),
      },
    });
    let faultPending = replyFault !== undefined;
    const api = createDevelopmentServer(async (r) => {
      const result = await service(r);
      if (
        faultPending &&
        r.method === 'POST' &&
        new URL(r.url).pathname.startsWith('/v2/customer/favourite-operations/') &&
        result.status === 200
      ) {
        faultPending = false;
        return Response.json(
          {
            error: {
              code: 'SYNTHETIC_LOST_REPLY',
              message: 'Synthetic committed reply unavailable.',
            },
          },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      return result;
    });
    servers.push(api);
    const origin = await listen(api);
    const result = {
      origin,
      tenantId,
      tenantSlug,
      listingId: tenantId === T ? LISTING : null,
      foreignSavedFixture,
      expiresAt,
      close,
    };
    Object.defineProperties(result, {
      configuration: {
        value: (webOrigin) => ({
          policy: 'synthetic-customer-session-v1',
          tenantId,
          apiOrigin: origin,
          webOrigin,
          expiresAt,
          users,
        }),
        enumerable: false,
      },
      pause: {
        value: () =>
          db.query(
            "UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",
            [tenantId, LISTING],
          ),
        enumerable: false,
      },
      resume: {
        value: () =>
          db.query(
            "UPDATE app_private.listings SET publication_status='published' WHERE tenant_id=$1 AND id=$2",
            [tenantId, LISTING],
          ),
        enumerable: false,
      },
      revoke: {
        value: () =>
          db.query(
            'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
            [tenantId, id(13)],
          ),
        enumerable: false,
      },
    });
    return Object.freeze(result);
  } catch (e) {
    await close();
    throw e;
  }
}
