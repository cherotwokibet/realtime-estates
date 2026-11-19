import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHostedPool, readHostedDatabaseEnvironment } from '../dist/hosted-database.js';
import { readHostedApiEnvironment } from '../dist/hosted-api.js';
import { readFirebaseBrowserEnvironment } from '../dist/browser-identity-runtime.js';
const projectId = 'realtor-synthetic-staging',
  serviceAccount = 'realtor-web@' + projectId + '.iam.gserviceaccount.com';
const cloud = {
  instanceConnectionName: projectId + ':africa-south1:realtor-test',
  database: 'realtor',
  serviceAccount,
  ipType: 'PRIVATE',
};
const env = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  K_SERVICE: 'synthetic-web',
  GOOGLE_CLOUD_PROJECT: projectId,
  BROWSER_IDENTITY_CLOUD_SQL_CONFIG: JSON.stringify(cloud),
};
const settings = () => readHostedDatabaseEnvironment(env, 'BROWSER_IDENTITY', projectId);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test('database transport selects only explicit matching-project IAM or verified TLS; rejects credentials and fallbacks', () => {
  const config = settings();
  assert.equal(config.kind, 'cloud-sql-iam');
  assert.equal(config.user, 'realtor-web@' + projectId + '.iam');
  assert.equal(Object.hasOwn(config, 'password'), false);
  const url = 'postgres://identity_login:synthetic-secret@db.example/app?sslmode=verify-full';
  assert.equal(
    readHostedDatabaseEnvironment({ BROWSER_IDENTITY_DATABASE_URL: url }, 'BROWSER_IDENTITY').kind,
    'tls-url',
  );
  for (const changed of [
    { BROWSER_IDENTITY_DATABASE_URL: url },
    { GOOGLE_APPLICATION_CREDENTIALS: 'key.json' },
    { PGPASSWORD: 'do-not-use' },
    { PGSSLMODE: 'disable' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { APP_ENV: 'production' },
    { NODE_ENV: 'development' },
    { K_SERVICE: undefined },
    { GOOGLE_CLOUD_PROJECT: 'other-project' },
  ])
    assert.throws(() =>
      readHostedDatabaseEnvironment({ ...env, ...changed }, 'BROWSER_IDENTITY', projectId),
    );
  for (const changed of [
    { password: 'secret' },
    { host: '127.0.0.1' },
    { ipType: 'PSC' },
    { serviceAccount: 'other@example.test' },
    { instanceConnectionName: 'other-project:africa-south1:realtor-test' },
    { database: 'postgres; DROP DATABASE app' },
  ])
    assert.throws(() =>
      readHostedDatabaseEnvironment(
        { ...env, BROWSER_IDENTITY_CLOUD_SQL_CONFIG: JSON.stringify({ ...cloud, ...changed }) },
        'BROWSER_IDENTITY',
        projectId,
      ),
    );
  assert.throws(() => readHostedDatabaseEnvironment({}, 'BROWSER_IDENTITY'));
  assert.throws(() =>
    readHostedDatabaseEnvironment(
      { BROWSER_IDENTITY_DATABASE_URL: url.replace('verify-full', 'require') },
      'BROWSER_IDENTITY',
    ),
  );
});
test('API and Firebase browser environment readers accept the same explicit IAM transport without a password URL', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const identity = readFirebaseBrowserEnvironment({
    ...env,
    FIREBASE_BROWSER_CONFIG: JSON.stringify({
      projectId,
      tenantId,
      applicationOrigin: 'https://web.example',
    }),
    BROWSER_IDENTITY_STORAGE_KEY: '01'.repeat(32),
  });
  assert.equal(identity.databaseConfig.kind, 'cloud-sql-iam');
  assert.equal(identity.databaseUrl, undefined);
  const api = readHostedApiEnvironment({
    ...env,
    BROWSER_IDENTITY_CLOUD_SQL_CONFIG: undefined,
    HOSTED_API_CLOUD_SQL_CONFIG: JSON.stringify(cloud),
    HOSTED_API_CONFIG: JSON.stringify({
      policy: 'realtor-staging-api-v1',
      projectId,
      tenantId,
      applicationOrigin: 'https://api.example',
      privacyNoticeVersion: 'synthetic-v1',
    }),
  });
  assert.equal(api.databaseConfig.kind, 'cloud-sql-iam');
  assert.equal(api.databaseUrl, undefined);
});
test('lazy IAM pool initializes once under concurrent demand and never passes driver credentials or host overrides', async () => {
  let made = 0,
    optionsCalls = 0,
    pools = 0,
    ended = 0,
    closed = 0,
    options;
  const client = {
    async query() {
      return { rows: [] };
    },
    release() {},
  };
  const pool = createHostedPool(settings(), 3, {
    connector: async () => {
      made++;
      return {
        async getOptions(input) {
          optionsCalls++;
          assert.deepEqual(input, {
            instanceConnectionName: cloud.instanceConnectionName,
            ipType: 'PRIVATE',
            authType: 'IAM',
          });
          return { stream: () => {}, password: 'do-not-use', host: 'do-not-use' };
        },
        close() {
          closed++;
        },
      };
    },
    pool: (o) => {
      pools++;
      options = o;
      return {
        async connect() {
          return client;
        },
        async end() {
          ended++;
        },
        on() {},
      };
    },
  });
  assert.equal(made, 0);
  assert.equal(pools, 0);
  assert.deepEqual(await Promise.all([pool.connect(), pool.connect()]), [client, client]);
  assert.equal(made, 1);
  assert.equal(optionsCalls, 1);
  assert.equal(pools, 1);
  assert.equal(options.user, settings().user);
  assert.equal(options.database, 'realtor');
  assert.equal(options.max, 3);
  assert.equal(typeof options.stream, 'function');
  for (const k of ['password', 'host', 'connectionString', 'ssl'])
    assert.equal(Object.hasOwn(options, k), false);
  assert.equal(pool.end(), pool.end());
  await pool.end();
  assert.equal(ended, 1);
  assert.equal(closed, 1);
  await assert.rejects(pool.connect());
});
test('TLS mode preserves the exact verified URL and never constructs a Cloud SQL connector', async () => {
  let options,
    ends = 0;
  const connectionString =
    'postgres://identity_login:synthetic-secret@db.example/app?sslmode=verify-full';
  const pool = createHostedPool({ kind: 'tls-url', connectionString }, 3, {
    connector: async () => {
      throw Error('Connector must not run');
    },
    pool: (o) => {
      options = o;
      return {
        async connect() {
          return {
            async query() {
              return { rows: [] };
            },
            release() {},
          };
        },
        async end() {
          ends++;
        },
        on() {},
      };
    },
  });
  await pool.connect();
  assert.equal(options.connectionString, connectionString);
  assert.equal(Object.hasOwn(options, 'stream'), false);
  await pool.end();
  assert.equal(ends, 1);
});
test('failed IAM initialization closes its connector, sanitizes errors and creates no fallback pool', async () => {
  let made = 0,
    closed = 0,
    pools = 0;
  const pool = createHostedPool(settings(), 3, {
    connector: async () => {
      made++;
      return {
        async getOptions() {
          throw Error('private synthetic credential');
        },
        close() {
          closed++;
        },
      };
    },
    pool: () => {
      pools++;
      throw Error('No fallback allowed');
    },
  });
  for (let i = 0; i < 2; i++)
    await assert.rejects(pool.connect(), (e) => e.message === 'Hosted database is unavailable.');
  assert.equal(made, 2);
  assert.equal(closed, 2);
  assert.equal(pools, 0);
  await pool.end();
});
test('closing during IAM initialization disposes the late connector without creating a driver pool', async () => {
  const started = deferred(),
    options = deferred();
  let closed = 0,
    pools = 0;
  const pool = createHostedPool(settings(), 3, {
    connector: async () => ({
      async getOptions() {
        started.resolve();
        return options.promise;
      },
      close() {
        closed++;
      },
    }),
    pool: () => {
      pools++;
      throw Error();
    },
  });
  const first = pool.connect();
  await started.promise;
  const rejected = assert.rejects(first);
  const ending = pool.end();
  options.resolve({ stream: () => {} });
  await rejected;
  await ending;
  assert.equal(closed, 1);
  assert.equal(pools, 0);
  await assert.rejects(pool.connect());
});
test('a connection arriving after shutdown is destroyed before it can execute a query', async () => {
  const started = deferred(),
    connected = deferred();
  let destroyed = false,
    closed = 0;
  const pool = createHostedPool(settings(), 3, {
    connector: async () => ({
      async getOptions() {
        return { stream: () => {} };
      },
      close() {
        closed++;
      },
    }),
    pool: () => ({
      async connect() {
        started.resolve();
        return connected.promise;
      },
      async end() {},
      on() {},
    }),
  });
  const first = pool.connect();
  await started.promise;
  const rejected = assert.rejects(first);
  await pool.end();
  connected.resolve({
    async query() {
      throw Error('Must not query');
    },
    release(bad) {
      destroyed = bad;
    },
  });
  await rejected;
  assert.equal(destroyed, true);
  assert.equal(closed, 1);
});
test('unused pool disposal does not contact Google, and partial driver construction is cleaned up', async () => {
  let called = 0,
    ended = 0,
    closed = 0;
  const unused = createHostedPool(settings(), 3, {
    connector: async () => {
      called++;
      throw Error();
    },
  });
  await unused.end();
  assert.equal(called, 0);
  const broken = createHostedPool(settings(), 3, {
    connector: async () => ({
      async getOptions() {
        return { stream: () => {} };
      },
      close() {
        closed++;
      },
    }),
    pool: () => ({
      async connect() {
        throw Error();
      },
      async end() {
        ended++;
      },
      on() {
        throw Error('private setup diagnostic');
      },
    }),
  });
  await assert.rejects(broken.connect(), (e) => e.message === 'Hosted database is unavailable.');
  assert.equal(ended, 1);
  assert.equal(closed, 1);
  await broken.end();
});
