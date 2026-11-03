// Disposable developer fixture only. Uses test migrations and restricted SET LOCAL ROLE,
// not a production login pool. Never imported by the API deployment entrypoint.
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
export async function startAdminAuditPreview({ mode, company = 'realtime-estates' } = {}) {
  if (
    mode !== 'synthetic-admin-audit-v1' ||
    process.env.NODE_ENV === 'production' ||
    !['realtime-estates', 'sample-homes'].includes(company)
  )
    throw Error('Unsupported audit preview.');
  const db = await fixture(),
    servers = [];
  try {
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/admin-audit-reads.sql', import.meta.url),
        'utf8',
      ),
    );
    for (let n = 0; n < 26; n++)
      await asActor(db, T, ADMIN, () =>
        db.query('SELECT app_api.approve_company_settings($1::jsonb)', [
          JSON.stringify({
            policy: 'company-settings-command-v1',
            operationId: id(8100 + n),
            expectedVersion: String(n),
            approval: 'approved-for-publication',
            content: {
              companyName: 'Synthetic Private Audit Source ' + n,
              summary: 'PRIVATE AUDIT SUMMARY SENTINEL',
              about: 'Fictional private source fixture only.',
              officeAddress: null,
              openingHours: 'Monday to Friday',
              colors: {
                primary: '#5e0202',
                secondary: '#194d3e',
                accent: '#b77b27',
                background: '#ffffff',
              },
            },
          }),
        ]),
      );
    const tenantId = company === 'realtime-estates' ? T : OTHER,
      actorId = company === 'realtime-estates' ? ADMIN : id(20);
    const keys = await generateKeyPair('RS256'),
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        alg: 'RS256',
        kid: 'synthetic-audit-preview',
        use: 'sig',
      };
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
      audience: 'synthetic-audit-preview',
      jwksUrl: issuer + '/.well-known/jwks.json',
      allowLoopbackHttpForTests: true,
    });
    const token = await new SignJWT({ synthetic: true })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer(issuer)
      .setAudience('synthetic-audit-preview')
      .setSubject(actorId)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(keys.privateKey);
    const service = createApiService({
      tenantId,
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      adminAuditMode: mode,
      verifyAuthorization: (r) =>
        verify(parseBearerHeader(r.headers.get('authorization') ?? undefined)),
      database: {
        transaction: ({ tenantId, actorId }, fn) => asActor(db, tenantId, actorId, () => fn(db)),
      },
    });
    const api = createDevelopmentServer(service);
    servers.push(api);
    const origin = await listen(api);
    let closed = false;
    const result = { origin, company, tenantId };
    Object.defineProperties(result, {
      token: { value: () => token },
      access: {
        value: async (enabled) => {
          if (typeof enabled !== 'boolean' || closed) throw Error('Invalid fixture control');
          await db.query(
            'UPDATE app_private.memberships SET active=$1,revoked_at=CASE WHEN $1 THEN NULL ELSE now() END WHERE tenant_id=$2 AND user_id=$3',
            [enabled, tenantId, actorId],
          );
        },
      },
      close: {
        value: async () => {
          if (closed) return;
          closed = true;
          for (const server of servers.reverse()) await close(server);
          await db.close();
        },
      },
    });
    return Object.freeze(result);
  } catch (error) {
    for (const server of servers.reverse()) await close(server);
    await db.close();
    throw error;
  }
}
