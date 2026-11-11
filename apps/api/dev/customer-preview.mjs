/** Owned synthetic customer fixture. Keys/tokens live only in memory and child server environment. */
import { randomUUID } from 'node:crypto';
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
  ADMIN,
  AGENT,
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
export async function startCustomerPreview({
  tenantSlug = 'realtime-estates',
  replyFault,
  mobileMode,
  pushMode,
  deletionMode,
  deletionReviewMode,
  deletionFollowUpMode,
  deletionReviewReplyFault,
  deletionReplyFault,
  enquiryReplyFault,
} = {}) {
  if (
    process.env.NODE_ENV !== 'development' ||
    !['realtime-estates', 'sample-homes'].includes(tenantSlug) ||
    (enquiryReplyFault !== undefined &&
      (enquiryReplyFault !== 'lost-first-enquiry-result-v1' || !mobileMode)) ||
    (deletionReplyFault !== undefined &&
      (deletionReplyFault !== 'lost-first-deletion-result-v1' || !deletionMode)) ||
    (deletionFollowUpMode !== undefined &&
      (deletionFollowUpMode !== 'synthetic-customer-deletion-follow-up-v1' ||
        !deletionReviewMode)) ||
    (deletionReviewMode !== undefined &&
      (deletionReviewMode !== 'synthetic-admin-deletion-review-v1' || !deletionMode)) ||
    (deletionReviewReplyFault !== undefined &&
      (deletionReviewReplyFault !== 'lost-first-deletion-review-v1' || !deletionReviewMode)) ||
    (deletionMode !== undefined &&
      (deletionMode !== 'synthetic-customer-deletion-v1' || !pushMode)) ||
    (pushMode !== undefined && pushMode !== 'synthetic-customer-push-v1') ||
    (mobileMode !== undefined && mobileMode !== 'synthetic-mobile-customer-v1') ||
    (replyFault !== undefined && replyFault !== 'lost-first-favourite-result-v1')
  )
    throw Error('Explicit supported development customer preview required.');
  const db = await fixture(),
    servers = [];
  let databaseTail = Promise.resolve();
  function withDatabase(operation) {
    const result = databaseTail.then(operation);
    databaseTail = result.catch(() => {});
    return result;
  }
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const s of servers.reverse()) await stop(s);
    await databaseTail;
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
    if (pushMode)
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/customer-push-preferences.sql', import.meta.url),
          'utf8',
        ),
      );
    if (deletionMode)
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/customer-deletion-requests.sql', import.meta.url),
          'utf8',
        ),
      );

    const tenantId = tenantSlug === 'sample-homes' ? OTHER : T;
    if (deletionReviewMode) {
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/customer-deletion-reviews.sql', import.meta.url),
          'utf8',
        ),
      );
      await db.query(
        "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
        [tenantId, id(25)],
      );
    }

    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$4,'customer'),($3,$2,'customer')",
      [T, id(14), OTHER, id(13)],
    );
    if (deletionFollowUpMode)
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/customer-deletion-follow-up.sql', import.meta.url),
          'utf8',
        ),
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
    let nativeListingId = null;
    if (mobileMode) {
      const { REFERENCE_PREVIEW_CATALOGUE, seedPublicReferenceListing } =
        await import('./staff-preview.mjs');
      for (const file of [
        'listing-reference-draft.sql',
        'listing-reference-catalogue-install.sql',
        'listing-reference-read.sql',
        'listing-reference-moderation.sql',
      ]) {
        await db.exec(
          await readFile(new URL('../../../database/proposals/' + file, import.meta.url), 'utf8'),
        );
      }
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
        JSON.stringify(REFERENCE_PREVIEW_CATALOGUE),
      ]);
      const agent = tenantId === T ? AGENT : id(21);
      if (tenantId === OTHER)
        await db.query(
          "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'agent')",
          [OTHER, agent],
        );
      const base = tenantId === T ? 400 : 500;
      await seedPublicReferenceListing(db, {
        id: tenantId,
        agent,
        admin: tenantId === T ? ADMIN : id(20),
        listing: id(base),
      });
      nativeListingId = id(base + 10);
    }
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
    const sign = (subject, start, end) =>
      new SignJWT({ synthetic: true })
        .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
        .setIssuer(issuer)
        .setAudience('synthetic-customer-preview-v1')
        .setSubject(subject)
        .setIssuedAt(start)
        .setExpirationTime(end)
        .sign(privateKey);
    const users = [];
    for (const [n, label] of [
      [13, 'Synthetic Customer A'],
      [14, 'Synthetic Customer B'],
    ])
      users.push({
        id: id(n),
        label,
        bearerToken: await sign(id(n), issued, issued + 900),
      });
    const service = createApiService({
      tenantId,
      privacyNoticeVersion: 'synthetic-customer-preview-v1',
      ...(mobileMode
        ? {
            referenceDraftMode: 'synthetic-reference-draft-v1',
            referenceModerationMode: 'synthetic-reference-transition-v1',
          }
        : {}),
      customerFavouritesMode: 'synthetic-customer-favourites-v1',
      customerPushMode: pushMode,
      customerDeletionMode: deletionMode,
      adminDeletionReviewMode: deletionReviewMode,
      deletionFollowUpMode,
      verifyAuthorization: (r) =>
        verify(parseBearerHeader(r.headers.get('authorization') ?? undefined)),
      database: {
        transaction: ({ tenantId, actorId }, fn) =>
          withDatabase(() => asActor(db, tenantId, actorId, () => fn(db))),
      },
    });
    let faultPending = replyFault !== undefined;
    let enquiryFaultPending = enquiryReplyFault !== undefined;
    let deletionFaultPending = deletionReplyFault === 'lost-first-deletion-result-v1';
    let deletionReviewFaultPending = deletionReviewReplyFault === 'lost-first-deletion-review-v1';
    const api = createDevelopmentServer(async (r) => {
      const url = new URL(r.url);
      if (mobileMode && url.pathname === '/dev/mobile-customer/session') {
        const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        const persona = r.headers.get('x-realtor-preview-customer');
        if (
          r.method !== 'POST' ||
          r.url !== origin + '/dev/mobile-customer/session' ||
          r.headers.has('origin') ||
          r.headers.has('sec-fetch-site') ||
          r.headers.has('authorization') ||
          r.headers.has('cookie') ||
          (persona !== 'a' && persona !== 'b')
        )
          return Response.json({ error: 'Preview sign-in unavailable.' }, { status: 404, headers });
        if ((await r.arrayBuffer()).byteLength !== 0)
          return Response.json({ error: 'Preview sign-in unavailable.' }, { status: 404, headers });
        const start = Math.floor(Date.now() / 1000);
        const end = Math.min(start + 120, issued + 900);
        if (end <= start)
          return Response.json({ error: 'Preview expired.' }, { status: 410, headers });
        const customerId = id(persona === 'a' ? 13 : 14);
        return Response.json(
          {
            policy: 'runtime-customer-grant-v1',
            tenantId,
            customerId,
            generation: randomUUID(),
            expiresAt: new Date(end * 1000).toISOString(),
            bearerToken: await sign(customerId, start, end),
          },
          { headers },
        );
      }
      const result = await service(r);
      if (
        deletionReviewFaultPending &&
        r.method === 'POST' &&
        url.pathname.startsWith('/v2/staff/customer-deletion-triage/') &&
        result.status === 200
      ) {
        deletionReviewFaultPending = false;
        const requestId = result.headers.get('x-request-id');
        return Response.json(
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Synthetic committed reply unavailable.',
            },
            requestId,
          },
          { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
        );
      }

      if (
        deletionFaultPending &&
        r.method === 'POST' &&
        url.pathname.startsWith('/v2/customer/deletion-requests/') &&
        result.status === 200
      ) {
        deletionFaultPending = false;
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

      if (
        enquiryFaultPending &&
        r.method === 'POST' &&
        url.pathname === '/v1/enquiries' &&
        result.status === 201
      ) {
        enquiryFaultPending = false;
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
      listingId: nativeListingId ?? (tenantId === T ? LISTING : null),
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
      viewingStaff: {
        value: async () => {
          if (!mobileMode) throw Error('The mobile preview is required.');
          const adminId = tenantId === T ? ADMIN : id(20);
          const agentId = tenantId === T ? AGENT : id(21);
          return Object.freeze({
            agentId,
            admin: Object.freeze({ bearerToken: await sign(adminId, issued, issued + 900) }),
            agent: Object.freeze({ bearerToken: await sign(agentId, issued, issued + 900) }),
          });
        },
        enumerable: false,
      },
      deletionReviewStaff: {
        value: async () => {
          if (!deletionReviewMode) throw Error('Deletion review fixture is unavailable.');
          const primary = tenantId === T ? ADMIN : id(20);
          return {
            reviewerId: primary,
            token: await sign(primary, issued, issued + 900),
            peerToken: await sign(id(25), issued, issued + 900),
            revoke: () =>
              withDatabase(() =>
                db.query(
                  'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
                  [tenantId, primary],
                ),
              ),
          };
        },
        enumerable: false,
      },
      enquiryCount: {
        value: () =>
          withDatabase(async () =>
            Number(
              (
                await db.query(
                  'SELECT count(*) AS total FROM app_private.enquiries WHERE tenant_id=$1',
                  [tenantId],
                )
              ).rows[0].total,
            ),
          ),
        enumerable: false,
      },
      pause: {
        value: () =>
          withDatabase(() =>
            db.query(
              "UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",
              [tenantId, nativeListingId ?? LISTING],
            ),
          ),
        enumerable: false,
      },
      resume: {
        value: () =>
          withDatabase(() =>
            db.query(
              "UPDATE app_private.listings SET publication_status='published' WHERE tenant_id=$1 AND id=$2",
              [tenantId, nativeListingId ?? LISTING],
            ),
          ),
        enumerable: false,
      },
      revoke: {
        value: () =>
          withDatabase(() =>
            db.query(
              'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
              [tenantId, id(13)],
            ),
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
