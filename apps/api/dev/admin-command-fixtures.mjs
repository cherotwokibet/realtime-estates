// Disposable signed command fixture. SET LOCAL ROLE test adapter, not a production login pool.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  fixture,
  asActor,
  T,
  OTHER,
  ADMIN,
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
const close = (s) =>
  new Promise((resolve) => {
    s.closeAllConnections();
    s.close(resolve);
  });
export async function startAdminCommandFixture({ staff = false } = {}) {
  const db = await fixture(),
    servers = [];
  try {
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [T, id(15)],
    );
    if (staff) {
      for (const file of [
        'staff-branches.sql',
        'staff-invitation-requests.sql',
        'staff-membership-changes.sql',
      ]) {
        await db.exec(
          await readFile(new URL('../../../database/proposals/' + file, import.meta.url), 'utf8'),
        );
      }
    }
    const keys = await generateKeyPair('RS256'),
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        alg: 'RS256',
        kid: 'settings-audit323',
        use: 'sig',
      };
    const jwks = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/jwks') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    servers.push(jwks);
    const issuer = await listen(jwks);
    const verify = createIdentityVerifier({
      issuer,
      audience: 'settings-audit323',
      jwksUrl: issuer + '/jwks',
      allowLoopbackHttpForTests: true,
    });
    const token = (subject = ADMIN, audience = 'settings-audit323') =>
      new SignJWT({ role: 'admin', tenantId: OTHER })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    const origins = [];
    for (const tenantId of [T, OTHER]) {
      const server = createDevelopmentServer(
        createApiService({
          privateOperationResolutionMode: 'synthetic-serialized-original-v1',
          tenantId,
          ...(staff
            ? {
                staffInvitationMode: 'synthetic-capture-only-v1',
                staffMembershipMode: 'synthetic-existing-members-v1',
              }
            : {}),
          privacyNoticeVersion: 'settings-audit323',
          verifyAuthorization: (r) =>
            verify(parseBearerHeader(r.headers.get('authorization') ?? undefined)),
          database: {
            transaction: ({ tenantId, actorId, correlationId }, fn) =>
              asActor(db, tenantId, actorId, async () => {
                await db.query("SELECT set_config('realtor.correlation_id',$1,true)", [
                  correlationId,
                ]);
                return fn(db);
              }),
          },
        }),
      );
      servers.push(server);
      origins.push(await listen(server));
    }
    const bearer = await token();
    async function request({
      value,
      operation = 9000,
      subject,
      origin = 0,
      method = value === undefined ? 'GET' : 'POST',
      headers = {},
      raw,
    } = {}) {
      const authorization =
        subject === null
          ? undefined
          : 'Bearer ' + (subject === undefined ? bearer : await token(subject));
      return fetch(origins[origin] + '/v2/staff/company-settings/operations/' + id(operation), {
        method,
        headers: {
          ...(authorization ? { authorization } : {}),
          ...(value === undefined && raw === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(value !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(value) } : {}),
        redirect: 'error',
      });
    }
    return {
      db,
      request,
      token,
      origins,
      close: async () => {
        for (const s of servers.reverse()) await close(s);
        await db.close();
      },
    };
  } catch (error) {
    for (const s of servers.reverse()) await close(s);
    await db.close();
    throw error;
  }
}
