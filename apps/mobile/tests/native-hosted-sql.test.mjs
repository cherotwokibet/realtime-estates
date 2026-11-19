import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import {
  fixture,
  publish,
  asActor,
  T,
  OTHER,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import {
  createHostedApiHandler,
  createFirebaseApiActorResolver,
} from '../../api/dist/hosted-api.js';
import { createHostedApiServer } from '../../api/dist/hosted-http.js';
import {
  createFirebaseIdentityVerifier,
  createFirebaseSubjectVerifier,
} from '../../api/dist/firebase-identity.js';
import { createNativeCustomerGateway } from '../../api/dist/native-customer-gateway.js';
import { createCloudRunInvocationTransport } from '../../api/dist/cloud-run-invocation.js';
import { PostgresTransactionDatabase } from '../../api/dist/database.js';
import { createFirebaseMobileSignIn } from '../dist/tests/src/firebase-customer-sign-in.js';
import { createNativeSavedProperties } from '../dist/tests/src/native-saved-properties.js';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CUSTOMER = id(13),
  PEER = id(14),
  FOREIGN = id(23);
const api = {
  policy: 'realtor-staging-api-v1',
  projectId: 'realtor-synthetic-staging',
  tenantId: T,
  applicationOrigin: 'https://synthetic-native-123456.us-central1.run.app',
  privacyNoticeVersion: 'synthetic-native-v1',
};
const gatewayOrigin = 'https://native-gateway.synthetic.invalid';
const nativeConfig = {
  mode: 'firebase-native-customer-v1',
  tenantId: T,
  apiOrigin: gatewayOrigin,
  firebase: {
    projectId: api.projectId,
    authDomain: api.projectId + '.firebaseapp.com',
    apiKey: 'AIza' + 'a'.repeat(35),
    appId: '1:123:web:abcdef123456',
  },
};
// Isolated test process only: no emulator, ADC, Google signature or external TLS proof is substituted.
process.env.NODE_ENV = 'production';

test('native customer protocol reaches the maintained HTTP envelope, hosted API and isolated SQL', async (t) => {
  const db = await fixture();
  let server, privateServer, client, saved;
  let operation = 9000,
    seed = 5000,
    generation = 8000;
  let activeToken = 'customer.native.signature',
    authority = 'normal',
    disposedProviders = 0,
    providerChecked = 0;
  let dropAfterCommit = false,
    dropBeforeDispatch = false,
    lastCommand;
  const attempts = [],
    wireCalls = [];
  const configTokens = new Map([
    ['customer.native.signature', 'native-customer'],
    ['peer.native.signature', 'native-peer'],
    ['foreign.native.signature', 'native-foreign'],
  ]);
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      const previous = tail;
      let unlock;
      tail = new Promise((done) => {
        unlock = done;
      });
      await previous;
      return {
        query: (sql, params) => db.query(sql, params),
        release() {
          unlock();
        },
      };
    },
  };
  const database = new PostgresTransactionDatabase(pool);
  async function admin(work) {
    // Fixture-owner inspections are separate from application calls; RESET alone does not
    // restore PGlite's owner identity after SET SESSION AUTHORIZATION.
    await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE;');
    try {
      return await work();
    } finally {
      await db.exec('SET SESSION AUTHORIZATION native_journey_api;RESET ROLE;');
    }
  }
  const rows = (sql, params = []) => admin(async () => (await db.query(sql, params)).rows);
  async function seedSaved() {
    await admin(async () => {
      const state = (
        await db.query(
          'SELECT version::text FROM app_private.customer_favourites WHERE tenant_id=$1 AND customer_id=$2 AND listing_id=$3',
          [T, CUSTOMER, LISTING],
        )
      ).rows[0];
      await asActor(db, T, CUSTOMER, () =>
        db.query('SELECT app_api.set_customer_favourite($1,$2,$3,true)', [
          id(++seed),
          LISTING,
          state?.version ?? '0',
        ]),
      );
    });
  }
  async function wire(url, init = {}, privateLeg = false) {
    const target = new URL(url);
    assert.equal(target.origin, privateLeg ? api.applicationOrigin : gatewayOrigin);
    assert.ok(target.pathname.startsWith('/v2/customer/'));
    assert.equal(init.credentials ?? 'omit', 'omit');
    if (!privateLeg) wireCalls.push({ method: init.method ?? 'GET', path: target.pathname });
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: (privateLeg ? privateServer : server).address().port,
          path: target.pathname + target.search,
          method: init.method ?? 'GET',
          signal: init.signal,
          headers: {
            Host: target.host,
            ...(init.body ? { 'Content-Length': Buffer.byteLength(init.body) } : {}),
            ...init.headers,
          },
        },
        (incoming) => {
          const chunks = [];
          let size = 0;
          incoming.on('data', (chunk) => {
            size += chunk.length;
            if (size > 32768) request.destroy(Error('Synthetic response exceeds limit'));
            else chunks.push(chunk);
          });
          incoming.on('error', reject);
          incoming.on('end', () => {
            const response = new Response(Buffer.concat(chunks), {
              status: incoming.statusCode,
              headers: incoming.headers,
            });
            // Test-only mapping of the declared HTTPS URL to owned loopback HTTP. No TLS claim.
            Object.defineProperty(response, 'url', { value: url });
            resolve(response);
          });
        },
      );
      request.on('error', reject);
      if (init.body) request.write(init.body);
      request.end();
    });
  }
  const transport = async (url, init) => {
    attempts.push({ url, method: init.method, body: init.body });
    assert.ok(disposedProviders > 0, 'native SDK session was disposed before private requests');
    assert.ok(
      !Object.keys(init.headers).some((key) =>
        /actor|tenant|role|company|preview|cookie/i.test(key),
      ),
    );
    if (init.method === 'POST') {
      lastCommand = JSON.parse(init.body);
      if (dropBeforeDispatch) {
        dropBeforeDispatch = false;
        throw Error('Synthetic pre-dispatch loss');
      }
    }
    const response = await wire(url, init);
    if (init.method === 'POST' && dropAfterCommit) {
      dropAfterCommit = false;
      assert.equal(response.status, 200);
      await response.body.cancel();
      throw Error('Synthetic committed acknowledgement loss');
    }
    return response;
  };
  const login = async (token = 'customer.native.signature') => {
    activeToken = token;
    client.signOut();
    return client.signIn('synthetic@example.invalid', 'synthetic-password-only');
  };
  try {
    await publish(db);
    for (const name of [
      'customer-favourites.sql',
      'browser-identity-state.sql',
      'firebase-actor-bindings.sql',
      'firebase-api-binding-lookup.sql',
    ])
      await db.exec(
        await readFile(new URL('../../../database/proposals/' + name, import.meta.url), 'utf8'),
      );
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$4,'customer')",
      [T, PEER, OTHER, FOREIGN],
    );
    for (const [uid, actor] of [
      ['native-customer', CUSTOMER],
      ['native-peer', PEER],
      ['native-foreign', FOREIGN],
    ])
      await db.query(
        'INSERT INTO identity.firebase_actor_bindings(project_id,firebase_uid,actor_id) VALUES($1,$2,$3)',
        [api.projectId, uid, actor],
      );
    await assert.rejects(
      database.checkConnection(),
      (error) => error.code === 'UNSAFE_DATABASE_ROLE',
    );
    await db.exec(
      'CREATE ROLE native_journey_api LOGIN NOINHERIT;GRANT api_runtime TO native_journey_api;SET SESSION AUTHORIZATION native_journey_api;',
    );
    await database.checkConnection();
    const verifierOptions = {
      verifier: {
        async verifyIdToken(token, checkRevoked) {
          providerChecked++;
          assert.equal(checkRevoked, true);
          const uid = configTokens.get(token);
          if (!uid || authority === 'revoked') throw Error('Synthetic authority refusal');
          const now = Math.floor(Date.now() / 1000);
          return {
            uid,
            sub: uid,
            aud: authority === 'foreign-project' ? 'foreign-project' : api.projectId,
            iss: 'https://securetoken.google.com/' + api.projectId,
            iat: now,
            auth_time: now,
            exp: now + 3600,
            email_verified: authority !== 'unverified',
            email: 'synthetic@example.invalid',
            firebase: { sign_in_provider: 'password' },
          };
        },
      },
    };
    const verify = createFirebaseIdentityVerifier(
      api,
      createFirebaseApiActorResolver(database, T),
      verifierOptions,
    );
    const privateHandler = createHostedApiHandler(api, database, verify);
    privateServer = createHostedApiServer(api.applicationOrigin, privateHandler);
    privateServer.listen(0, '127.0.0.1');
    await once(privateServer, 'listening');
    const invocation = createCloudRunInvocationTransport(
      { policy: 'cloud-run-invocation-v1', audience: api.applicationOrigin },
      {
        client: async () => ({
          getRequestHeaders: async () =>
            new Headers({ Authorization: 'Bearer synthetic.gateway.signature' }),
        }),
        transport: async (request) => {
          assert.equal(
            request.headers.get('x-serverless-authorization'),
            'Bearer synthetic.gateway.signature',
          );
          assert.ok(configTokens.has(request.headers.get('authorization')?.slice(7)));
          // The real private HTTP envelope strips workload routing headers before the domain handler.
          const headers = Object.fromEntries(request.headers);
          const body = request.method === 'POST' ? await request.text() : undefined;
          return wire(
            request.url,
            { method: request.method, headers, body, signal: request.signal },
            true,
          );
        },
      },
    );
    const gateway = createNativeCustomerGateway(
      {
        policy: 'native-customer-gateway-v1',
        projectId: api.projectId,
        tenantId: T,
        applicationOrigin: gatewayOrigin,
        apiOrigin: api.applicationOrigin,
      },
      { transport: invocation, verifySubject: createFirebaseSubjectVerifier(api, verifierOptions) },
    );
    server = createHostedApiServer(gatewayOrigin, gateway);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    client = createFirebaseMobileSignIn(nativeConfig, {
      fetch: transport,
      uuid: () => id(++generation),
      provider: () => ({
        async password(email, password) {
          assert.equal(email, 'synthetic@example.invalid');
          assert.equal(password, 'synthetic-password-only');
          return {
            idToken: activeToken,
            expiresAt: new Date(Date.now() + 3500000).toISOString(),
            emailVerified: true,
          };
        },
        async dispose() {
          disposedProviders++;
        },
      }),
    });
    saved = createNativeSavedProperties(
      client.session,
      'https://properties.synthetic.invalid',
      12000,
      () => id(++operation),
    );

    await t.test(
      'modeled API login attests and cannot read raw favourite or identity tables',
      async () => {
        for (const table of ['app_private.customer_favourites', 'identity.firebase_actor_bindings'])
          await assert.rejects(
            database.transaction(
              { tenantId: T, actorId: CUSTOMER, correlationId: 'synthetic-native' },
              (q) => q.query('SELECT * FROM ' + table),
            ),
            (error) => error.code === '42501',
          );
      },
    );
    await t.test(
      'native login resolves the real SQL binding and reads actual published saved rows',
      async () => {
        await seedSaved();
        assert.equal(await login(), true);
        assert.equal(client.session.snapshot().account.customerId, CUSTOMER);
        assert.equal(await saved.first(), true);
        assert.equal(saved.snapshot().page.items[0].listingId, LISTING);
        assert.equal(saved.snapshot().page.items[0].available, true);
        assert.ok(saved.propertyUrl(LISTING).endsWith('/properties/' + LISTING));
      },
    );
    await t.test(
      'dropped committed acknowledgement recovers the exact SQL original without a second mutation',
      async () => {
        const prior = (
          await rows(
            'SELECT version::text FROM app_private.customer_favourites WHERE tenant_id=$1 AND customer_id=$2 AND listing_id=$3',
            [T, CUSTOMER, LISTING],
          )
        )[0];
        dropAfterCommit = true;
        const before = attempts.length;
        assert.equal(await saved.remove(LISTING, saved.revision()), false);
        assert.equal(saved.snapshot().operation, 'uncertain');
        const command = { ...lastCommand };
        let state = (
          await rows(
            'SELECT version::text,saved FROM app_private.customer_favourites WHERE tenant_id=$1 AND customer_id=$2 AND listing_id=$3',
            [T, CUSTOMER, LISTING],
          )
        )[0];
        assert.equal(state.saved, false);
        assert.equal(BigInt(state.version), BigInt(prior.version) + 1n);
        assert.equal(await saved.retryRemoval(saved.revision()), false);
        assert.equal(await saved.recoverRemoval(saved.revision()), true);
        assert.equal(saved.snapshot().operation, 'removed');
        const relevant = attempts.slice(before).filter((a) => a.url.includes(command.operationId));
        assert.deepEqual(
          relevant.map((a) => a.method),
          ['POST', 'GET'],
        );
        assert.equal(relevant[0].url, relevant[1].url);
        assert.equal(
          (
            await rows(
              'SELECT count(*)::int AS n FROM app_private.customer_favourite_operations WHERE tenant_id=$1 AND customer_id=$2 AND operation_id=$3',
              [T, CUSTOMER, command.operationId],
            )
          )[0].n,
          1,
        );
        const changed = { ...command, expectedVersion: '0' };
        const refused = await wire(
          gatewayOrigin + '/v2/customer/favourite-operations/' + command.operationId,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer customer.native.signature',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(changed),
          },
        );
        assert.equal(refused.status, 409);
        await refused.body.cancel();
        assert.equal(await saved.continueRemoval(saved.revision()), true);
        assert.equal(saved.snapshot().page.items.length, 0);
      },
    );
    await t.test(
      'pre-dispatch loss gets a genuine missing original and explicit identical retry commits once',
      async () => {
        await seedSaved();
        await saved.first();
        dropBeforeDispatch = true;
        const before = attempts.length;
        assert.equal(await saved.remove(LISTING, saved.revision()), false);
        assert.equal(await saved.recoverRemoval(saved.revision()), false);
        assert.equal(saved.snapshot().operation, 'missing');
        assert.equal(await saved.retryRemoval(saved.revision()), true);
        const relevant = attempts
          .slice(before)
          .filter((a) => a.url.includes(lastCommand.operationId));
        assert.deepEqual(
          relevant.map((a) => a.method),
          ['POST', 'GET', 'POST'],
        );
        assert.equal(relevant[0].body, relevant[2].body);
        assert.equal(relevant[0].url, relevant[2].url);
        assert.equal(
          (
            await rows(
              'SELECT count(*)::int AS n FROM app_private.customer_favourite_operations WHERE operation_id=$1',
              [lastCommand.operationId],
            )
          )[0].n,
          1,
        );
        await saved.continueRemoval(saved.revision());
      },
    );
    await t.test(
      'a concurrent SQL version change produces conflict without overwriting current facts',
      async () => {
        await seedSaved();
        await saved.first();
        const version = saved.snapshot().page.items[0].version;
        await admin(() =>
          asActor(db, T, CUSTOMER, () =>
            db.query('SELECT app_api.set_customer_favourite($1,$2,$3,false)', [
              id(++seed),
              LISTING,
              version,
            ]),
          ),
        );
        assert.equal(await saved.remove(LISTING, saved.revision()), true);
        assert.equal(saved.snapshot().operation, 'conflict');
        const state = (
          await rows(
            'SELECT version::text,saved FROM app_private.customer_favourites WHERE tenant_id=$1 AND customer_id=$2 AND listing_id=$3',
            [T, CUSTOMER, LISTING],
          )
        )[0];
        assert.equal(BigInt(state.version), BigInt(version) + 1n);
        assert.equal(state.saved, false);
        await saved.continueRemoval(saved.revision());
      },
    );
    await t.test(
      'peer and foreign-company identities cannot recover another account original',
      async () => {
        const original = lastCommand.operationId;
        assert.equal(await login('peer.native.signature'), true);
        assert.equal(await saved.first(), true);
        assert.equal(saved.snapshot().page.items.length, 0);
        const denied = await wire(gatewayOrigin + '/v2/customer/favourite-operations/' + original, {
          headers: { Authorization: 'Bearer peer.native.signature' },
        });
        assert.equal(denied.status, 404);
        assert.ok(!(await denied.text()).includes(original));
        assert.equal(await login('foreign.native.signature'), false);
        assert.equal(client.session.snapshot().status, 'signed_out');
      },
    );
    await t.test(
      'current SQL membership or binding revocation refuses the next read and clears native state',
      async () => {
        await seedSaved();
        assert.equal(await login(), true);
        await saved.first();
        await admin(() =>
          db.query(
            'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
            [T, CUSTOMER],
          ),
        );
        assert.equal(await saved.reload(), false);
        assert.equal(client.session.snapshot().status, 'signed_out');
        assert.equal(saved.snapshot().page, null);
        await admin(() =>
          db.query(
            'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
            [T, CUSTOMER],
          ),
        );
        assert.equal(await login(), true);
        await saved.first();
        await admin(() =>
          db.query(
            'UPDATE identity.firebase_actor_bindings SET active=false WHERE firebase_uid=$1',
            ['native-customer'],
          ),
        );
        assert.equal(await saved.reload(), false);
        assert.equal(client.session.snapshot().status, 'signed_out');
        await admin(() =>
          db.query(
            'UPDATE identity.firebase_actor_bindings SET active=true WHERE firebase_uid=$1',
            ['native-customer'],
          ),
        );
      },
    );
    await t.test(
      'strict server checks reject unverified/revoked/foreign-project authority despite client metadata',
      async () => {
        for (authority of ['unverified', 'revoked', 'foreign-project']) {
          assert.equal(await login(), false);
          assert.equal(client.session.snapshot().status, 'signed_out');
        }
        authority = 'normal';
        assert.equal(await login(), true);
      },
    );
    await t.test(
      'HTTP envelope refuses forged authority before verification and no token enters SQL originals',
      async () => {
        const before = providerChecked;
        const denied = await wire(gatewayOrigin + '/v2/customer/account', {
          headers: { Authorization: 'Bearer customer.native.signature', 'x-actor-id': CUSTOMER },
        });
        assert.equal(denied.status, 400);
        await denied.body.cancel();
        assert.equal(providerChecked, before);
        const originals = await rows(
          'SELECT receipt FROM app_private.customer_favourite_operations',
        );
        const serialized = JSON.stringify(originals);
        for (const token of configTokens.keys()) assert.ok(!serialized.includes(token));
        assert.ok(!serialized.includes('synthetic-password-only'));
        assert.ok(providerChecked > 0);
        assert.ok(wireCalls.length > 10);
        client.signOut();
        assert.equal(saved.snapshot().page, null);
        assert.equal(client.session.snapshot().status, 'signed_out');
      },
    );
    t.diagnostic(
      JSON.stringify({
        transport: 'owned-loopback-http',
        database: 'PGlite',
        authority: 'explicitly-injected',
        gateway: 'customer-only',
        privateInvocation: 'injected-service-credential',
        wireRequests: wireCalls.length,
        injectedProviderChecks: providerChecked,
        realTlsVerified: false,
        realFirebaseVerified: false,
        managedDatabaseVerified: false,
      }),
    );
  } finally {
    saved?.dispose();
    client?.dispose();
    for (const listener of [server, privateServer]) {
      if (!listener) continue;
      listener.closeAllConnections();
      await new Promise((resolve) => listener.close(resolve));
    }
    await db.close();
  }
});
