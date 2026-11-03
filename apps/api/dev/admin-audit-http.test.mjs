import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  fixture,
  asActor,
  T,
  OTHER,
  ADMIN,
  AGENT,
} from '../../../database/tests/public-media-fixtures.mjs';
import { createApiService } from '../dist/service.js';
import { createIdentityVerifier, parseBearerHeader } from '../dist/auth.js';
import { createDevelopmentServer } from '../dist/http.js';
import { RealtorApiClient } from '@realtor/api-client';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const query = { limit: 20, before: null, actorId: null, objectId: null };
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

test('signed audit HTTP/shared SDK reads actual command facts and enforces current authority without write replay', async () => {
  const db = await fixture(),
    servers = [];
  try {
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/admin-audit-reads.sql', import.meta.url),
        'utf8',
      ),
    );
    const settings = {
      policy: 'company-settings-command-v1',
      operationId: id(7100),
      expectedVersion: '0',
      approval: 'approved-for-publication',
      content: {
        companyName: 'Synthetic Audit Agency',
        summary: 'Synthetic approved summary.',
        about: 'Fictional audit fixture only.',
        officeAddress: null,
        openingHours: 'Monday to Friday',
        colors: {
          primary: '#5e0202',
          secondary: '#194d3e',
          accent: '#b77b27',
          background: '#ffffff',
        },
      },
    };
    await asActor(db, T, ADMIN, () =>
      db.query('SELECT app_api.approve_company_settings($1::jsonb)', [JSON.stringify(settings)]),
    );
    // Replay the exact command: one durable event, not a second action.
    await asActor(db, T, ADMIN, () =>
      db.query('SELECT app_api.approve_company_settings($1::jsonb)', [JSON.stringify(settings)]),
    );
    const keys = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(keys.publicKey)), alg: 'RS256', kid: 'audit319', use: 'sig' };
    const jwks = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    servers.push(jwks);
    const issuer = await listen(jwks);
    const verify = createIdentityVerifier({
      issuer,
      audience: 'audit319',
      jwksUrl: issuer + '/jwks',
      allowLoopbackHttpForTests: true,
    });
    const token = (subject, aud = 'audit319') =>
      new SignJWT({ role: 'admin', tenantId: T })
        .setProtectedHeader({ alg: 'RS256', kid: 'audit319' })
        .setIssuer(issuer)
        .setAudience(aud)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    const origins = [];
    for (const tenant of [T, OTHER]) {
      const service = createApiService({
        tenantId: tenant,
        privacyNoticeVersion: 'audit319',
        adminAuditMode: 'synthetic-admin-audit-v1',
        verifyAuthorization: (r) =>
          verify(parseBearerHeader(r.headers.get('authorization') ?? undefined)),
        database: {
          transaction: ({ tenantId, actorId }, fn) => asActor(db, tenantId, actorId, () => fn(db)),
        },
      });
      const server = createDevelopmentServer(service);
      servers.push(server);
      origins.push(await listen(server));
    }
    const clients = origins.map(
      (baseUrl) =>
        new RealtorApiClient({
          baseUrl,
          privacyNoticeVersion: 'audit319',
          allowLoopbackHttp: true,
        }),
    );
    const auth = { bearerToken: await token(ADMIN) };
    const result = await clients[0].listAdminAuditEvents(T, query, auth);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].action, 'company.settings.approved');
    assert.equal(result.items[0].actorId, ADMIN);
    assert.equal(result.items[0].objectId, T);
    assert.equal(result.items[0].objectVersion, '1');
    assert.doesNotMatch(JSON.stringify(result), /approval|operationId|summary|about|correlation/);
    assert.equal(
      (await clients[0].listAdminAuditEvents(T, { ...query, actorId: ADMIN, objectId: T }, auth))
        .items.length,
      1,
    );
    assert.equal(
      (await clients[0].listAdminAuditEvents(T, { ...query, actorId: AGENT }, auth)).items.length,
      0,
    );
    for (const subject of [AGENT, id(13), id(20)]) {
      const bearerToken = await token(subject);
      await assert.rejects(
        () => clients[0].listAdminAuditEvents(T, query, { bearerToken }),
        (e) => e.kind === 'HTTP' && e.status === 403 && e.serverCode === 'FORBIDDEN',
      );
    }
    await assert.rejects(
      () => clients[1].listAdminAuditEvents(OTHER, query, auth),
      (e) => e.kind === 'HTTP' && e.status === 403 && e.serverCode === 'FORBIDDEN',
    );
    const other = await clients[1].listAdminAuditEvents(OTHER, query, {
      bearerToken: await token(id(20)),
    });
    assert.deepEqual(other.items, []);
    const wrongAudience = await token(ADMIN, 'wrong');
    await assert.rejects(
      () => clients[0].listAdminAuditEvents(T, query, { bearerToken: wrongAudience }),
      (e) => e.kind === 'HTTP' && e.status === 401 && e.serverCode === 'UNAUTHENTICATED',
    );
    const parts = auth.bearerToken.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    await assert.rejects(
      () => clients[0].listAdminAuditEvents(T, query, { bearerToken: parts.join('.') }),
      (e) => e.kind === 'HTTP' && e.status === 401 && e.serverCode === 'UNAUTHENTICATED',
    );
    await db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await assert.rejects(
      () => clients[0].listAdminAuditEvents(T, query, auth),
      (e) => e.kind === 'HTTP' && e.status === 403 && e.serverCode === 'FORBIDDEN',
    );
    await db.query(
      "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await assert.rejects(
      () => clients[0].listAdminAuditEvents(T, query, auth),
      (e) => e.kind === 'HTTP' && e.status === 403 && e.serverCode === 'FORBIDDEN',
    );
    await db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await assert.rejects(
      () => clients[0].listAdminAuditEvents(T, query, auth),
      (e) => e.kind === 'HTTP' && e.status === 403 && e.serverCode === 'FORBIDDEN',
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM app_private.audit_events')).rows[0].n,
      1,
    );
  } finally {
    for (const server of servers.reverse()) await close(server);
    await db.close();
  }
});
