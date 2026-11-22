/** Owned disposable file-backed SQL test fixture. Never a deployable database/login adapter. */
import { realpath, readFile, lstat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { asActor } from '../../../database/tests/public-media-fixtures.mjs';
import { createApiService } from '../dist/service.js';
import { createDevelopmentServer } from '../dist/http.js';
import { createIdentityVerifier, parseBearerHeader } from '../dist/auth.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const marker = 'owned-disposable-recovery-ledger-v1\n';
export async function ownedLedgerRoot(root) {
  const physical = await realpath(root),
    temp = await realpath(tmpdir());
  if (
    process.env.NODE_ENV === 'production' ||
    physical !== root ||
    dirname(physical) !== temp ||
    !/^realtor-ledger490-[a-zA-Z0-9]+$/.test(basename(physical)) ||
    (await lstat(root)).isSymbolicLink() ||
    (await readFile(join(root, 'owner.txt'), 'utf8')) !== marker
  )
    throw Error('Owned recovery ledger unavailable.');
  return physical;
}
const listen = (s) =>
  new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + s.address().port));
  });
const closeServer = (s) =>
  new Promise((resolve) => {
    s.closeAllConnections();
    s.close(resolve);
  });
export async function startRecoveryLedgerFixture(input) {
  const root = await ownedLedgerRoot(input.root),
    path = join(root, 'pgdata'),
    servers = [];
  if (input.initialize === true) {
    try {
      await lstat(path);
      throw Error('Existing recovery ledger cannot be initialized.');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  } else {
    // Never create a new empty database when the original directory has gone missing.
    const version = await lstat(join(path, 'PG_VERSION'));
    if (
      !version.isFile() ||
      version.isSymbolicLink() ||
      (await lstat(path)).isSymbolicLink() ||
      (await realpath(path)) !== path
    )
      throw Error('Recovery ledger missing.');
  }
  const db = new PGlite(path);
  try {
    if (input.initialize === true) {
      await applyTestMigrations(db);
      await db.query(
        "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'realtime-estates','Synthetic owned recovery ledger')",
        [id(1)],
      );
      for (const [actor, role] of [
        [10, 'admin'],
        [11, 'agent'],
        [15, 'admin'],
      ])
        await db.query(
          'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
          [id(1), id(actor), role],
        );
    }
    if (input.membershipRole !== undefined) {
      if (!['admin', 'agent'].includes(input.membershipRole)) throw Error('Invalid fixture role');
      await db.query(
        'UPDATE app_private.memberships SET role=$1 WHERE tenant_id=$2 AND user_id=$3',
        [input.membershipRole, id(1), id(10)],
      );
    }
    const keys = await generateKeyPair('RS256'),
      kid = randomUUID(),
      jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: 'RS256', use: 'sig' };
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
    const issuer = await listen(jwks),
      audience = 'owned-recovery-ledger490';
    const verify = createIdentityVerifier({
      issuer,
      audience,
      jwksUrl: issuer + '/jwks',
      allowLoopbackHttpForTests: true,
    });
    const subject = id(input.subject ?? 10),
      bearerToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    let queue = Promise.resolve(),
      corrupt = input.corruptFirstReply === true,
      writeRequests = 0;
    const service = createApiService({
      tenantId: id(1),
      privacyNoticeVersion: audience,
      privateOperationResolutionMode: 'synthetic-serialized-original-v1',
      verifyAuthorization: (r) =>
        verify(parseBearerHeader(r.headers.get('authorization') ?? undefined)),
      database: {
        transaction: (context, fn) => {
          const run = queue.then(() =>
            asActor(db, context.tenantId, context.actorId, async () => {
              await db.query("SELECT set_config('realtor.correlation_id',$1,true)", [
                context.correlationId,
              ]);
              return fn(db);
            }),
          );
          queue = run.catch(() => {});
          return run;
        },
      },
    });
    const server = createDevelopmentServer(async (request, source) => {
      const isWrite =
        request.method === 'POST' &&
        new URL(request.url).pathname.startsWith('/v2/staff/company-settings/operations/');
      if (isWrite) writeRequests++;
      const response = await service(request, source);
      if (corrupt && isWrite && response.status === 200) {
        corrupt = false;
        await response.body?.cancel();
        return Response.json(
          { syntheticReplyCorruption: true },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      return response;
    });
    servers.push(server);
    const origin = await listen(server);
    return {
      origin,
      bearerToken,
      subject,
      signingFingerprint: createHash('sha256').update(JSON.stringify(jwk)).digest('hex'),
      writeRequests: () => writeRequests,
      inspect: async () => {
        await queue;
        const rows = (
          await db.query(
            'SELECT app_private.company_settings_record_json(r) AS receipt FROM app_private.company_settings_records r ORDER BY version',
          )
        ).rows;
        return {
          count: rows.length,
          receiptDigest: rows.length
            ? createHash('sha256').update(JSON.stringify(rows[0].receipt)).digest('hex')
            : null,
        };
      },
      close: async () => {
        for (const s of servers.reverse()) await closeServer(s);
        await queue;
        await db.close();
      },
    };
  } catch (e) {
    for (const s of servers.reverse()) await closeServer(s);
    await db.close();
    throw e;
  }
}
