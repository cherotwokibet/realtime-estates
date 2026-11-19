import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile, chmod } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';

const image =
  'postgres:17-bookworm@sha256:837bed18782820fe967067cb5328b02b0d9992c1be9a37ee0c9c492cfc03af3b';
const wrongHost = 'realtor-ci-wrong-host.invalid';
async function deadline(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function child(args, env) {
  const processChild = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = (chunk) => {
    output = (output + chunk.toString()).slice(-16384);
  };
  processChild.stdout.on('data', collect);
  processChild.stderr.on('data', collect);
  const closed = new Promise((r, reject) => {
    processChild.once('error', reject);
    processChild.once('exit', (code, signal) => r({ code, signal }));
  });
  closed.catch(() => {});
  return { processChild, closed, output: () => output };
}
async function stop(owned) {
  if (owned.processChild.exitCode === null && owned.processChild.signalCode === null)
    owned.processChild.kill('SIGTERM');
  try {
    return await deadline(owned.closed, 11000, 'Owned API shutdown timed out.');
  } catch (e) {
    owned.processChild.kill('SIGKILL');
    await owned.closed;
    throw e;
  }
}
function health(port, headers = {}) {
  return new Promise((resolveResponse, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/healthz',
        method: 'GET',
        headers: { host: 'api.realtor-ci.invalid', connection: 'close', ...headers },
        agent: false,
        timeout: 1500,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolveResponse({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.once('error', reject);
    req.once('timeout', () => req.destroy(Error('Owned health request timed out.')));
    req.end();
  });
}
export async function verifyPostgresTlsStartup(t, owner, ownerUrl, { tenant }) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.REALTOR_POSTGRES_TEST_POLICY, 'owned-disposable-ci-v1');
  const container = process.env.REALTOR_POSTGRES_TEST_CONTAINER;
  assert.match(container ?? '', /^[a-f0-9]{64}$/);
  const docker = (args) =>
    execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 16384 });
  assert.equal(docker(['inspect', '--format', '{{.Config.Image}}', container]).trim(), image);
  const runnerTemp = await realpath(process.env.RUNNER_TEMP ?? '');
  assert.ok(runnerTemp.startsWith('/'));
  const directory = await mkdtemp(join(runnerTemp, 'realtor-ci-tls-'));
  assert.ok(resolve(directory).startsWith(runnerTemp + sep));
  await chmod(directory, 0o700);
  const openssl = (args) =>
    execFileSync('openssl', args, {
      cwd: directory,
      stdio: 'pipe',
      timeout: 30000,
      maxBuffer: 16384,
    });
  openssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.crt',
    '-days',
    '1',
    '-subj',
    '/CN=Realtor disposable CI root',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  ]);
  openssl([
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'server.key',
    '-out',
    'server.csr',
    '-subj',
    '/CN=localhost',
  ]);
  await writeFile(
    join(directory, 'server.ext'),
    'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=critical,CA:FALSE\n',
    { mode: 0o600 },
  );
  openssl([
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.crt',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'server.crt',
    '-days',
    '1',
    '-extfile',
    'server.ext',
  ]);
  const serverDirectory = '/tmp/realtor-ci-tls-' + randomUUID();
  docker(['exec', '--user', 'root', container, 'mkdir', serverDirectory]);
  for (const name of ['server.key', 'server.crt'])
    docker(['cp', join(directory, name), container + ':' + serverDirectory + '/' + name]);
  docker([
    'exec',
    '--user',
    'root',
    container,
    'chown',
    'postgres:postgres',
    serverDirectory + '/server.key',
    serverDirectory + '/server.crt',
  ]);
  docker(['exec', '--user', 'root', container, 'chmod', '600', serverDirectory + '/server.key']);
  // This is an owned disposable Linux runner, never the user's Windows hosts file.
  execFileSync('sudo', ['-n', 'tee', '-a', '/etc/hosts'], {
    input: '\n127.0.0.1 ' + wrongHost + '\n',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  });
  for (const [key, value] of [
    ['ssl_cert_file', serverDirectory + '/server.crt'],
    ['ssl_key_file', serverDirectory + '/server.key'],
    ['ssl', 'on'],
  ]) {
    await owner.query('ALTER SYSTEM SET ' + key + " = '" + value + "'");
  }
  assert.equal((await owner.query('SELECT pg_reload_conf() AS reloaded')).rows[0].reloaded, true);
  // SIGHUP processing is asynchronous; wait for this existing backend to observe ssl=on.
  const until = Date.now() + 5000;
  while ((await owner.query('SHOW ssl')).rows[0].ssl !== 'on') {
    assert.ok(Date.now() < until, 'Disposable server did not enable TLS.');
    await new Promise((r) => setTimeout(r, 100));
  }
  await owner.query(
    "CREATE ROLE staging_ci_tls_runtime LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'synthetic-ci-tls-only'; GRANT api_runtime TO staging_ci_tls_runtime;",
  );
  const url = new URL(ownerUrl);
  url.hostname = 'localhost';
  url.username = 'staging_ci_tls_runtime';
  url.password = 'synthetic-ci-tls-only';
  url.search = '?sslmode=verify-full';
  const badHostUrl = new URL(url);
  badHostUrl.hostname = wrongHost;
  const privilegedUrl = new URL(url);
  privilegedUrl.username = ownerUrl.username;
  privilegedUrl.password = ownerUrl.password;
  const baseEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC' };
  const trustedEnv = { ...baseEnv, NODE_EXTRA_CA_CERTS: join(directory, 'ca.crt') };
  const probeScript = `import pg from 'pg';const client=new pg.Client({connectionString:process.env.REALTOR_CI_TLS_URL,connectionTimeoutMillis:5000});try{await client.connect();console.log(JSON.stringify((await client.query('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]));}catch(e){console.log(JSON.stringify({code:e.code}));process.exitCode=1;}finally{await client.end();}`;
  async function probe(connectionString, trust = true) {
    const c = child(['--dns-result-order=ipv4first', '--input-type=module', '-e', probeScript], {
      ...(trust ? trustedEnv : baseEnv),
      REALTOR_CI_TLS_URL: connectionString,
    });
    try {
      const result = await deadline(c.closed, 8000, 'Owned TLS probe timed out.');
      return { ...result, result: JSON.parse(c.output().trim()) };
    } finally {
      await stop(c);
    }
  }
  await t.test(
    'pinned PostgreSQL driver verifies the generated CA and negotiates encrypted TLS',
    async () => {
      const p = await probe(url.href);
      assert.equal(p.code, 0);
      assert.equal(p.result.ssl, true);
      assert.match(p.result.version, /^TLSv1\.[23]$/);
    },
  );
  await t.test(
    'TLS driver refuses an untrusted CA and a trusted certificate for the wrong DNS host',
    async () => {
      const unknown = await probe(url.href, false);
      assert.equal(unknown.code, 1);
      assert.ok(
        [
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          'SELF_SIGNED_CERT_IN_CHAIN',
          'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        ].includes(unknown.result.code),
        JSON.stringify(unknown.result),
      );
      const mismatch = await probe(badHostUrl.href);
      assert.equal(mismatch.code, 1);
      assert.equal(mismatch.result.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    },
  );
  const config = {
    policy: 'realtor-staging-api-v1',
    projectId: 'realtor-synthetic-staging',
    tenantId: tenant,
    applicationOrigin: 'https://api.realtor-ci.invalid',
    privacyNoticeVersion: 'synthetic-ci-v1',
  };
  function api(connectionString, port, trust = true) {
    return child(['--dns-result-order=ipv4first', 'apps/api/dist/hosted-index.js'], {
      ...(trust ? trustedEnv : baseEnv),
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      GOOGLE_CLOUD_PROJECT: config.projectId,
      K_SERVICE: 'synthetic-ci-not-cloud-run',
      HOSTED_API_CONFIG: JSON.stringify(config),
      HOSTED_API_DATABASE_URL: connectionString,
      PORT: String(port),
    });
  }
  await t.test(
    'actual API entry point refuses TLS failures and privileged database login without fallback',
    async () => {
      for (const [target, trust] of [
        [url.href, false],
        [badHostUrl.href, true],
        [privilegedUrl.href, true],
      ]) {
        const c = api(target, 18080, trust);
        try {
          const r = await deadline(c.closed, 10000, 'Refused API candidate did not exit.');
          assert.equal(r.code, 1);
          assert.match(c.output(), /Staging API startup failed\./);
        } finally {
          await stop(c);
        }
      }
    },
  );
  await t.test(
    'actual API starts over verified PostgreSQL TLS, enforces health envelope and drains on SIGTERM',
    async () => {
      const port = 18080,
        c = api(url.href, port);
      try {
        let response;
        const readyUntil = Date.now() + 15000;
        while (!response) {
          assert.equal(c.processChild.exitCode, null, 'API exited before health: ' + c.output());
          assert.ok(Date.now() < readyUntil, 'Positive API startup timed out.');
          try {
            response = await health(port);
          } catch {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
        assert.equal(response.status, 200);
        assert.equal(response.body, '{"status":"ok"}');
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal((await health(port, { host: 'untrusted.realtor-ci.invalid' })).status, 400);
        assert.equal((await health(port, { 'x-actor-id': 'synthetic-forged-actor' })).status, 400);
        assert.equal(
          (await health(port, { origin: 'https://untrusted.realtor-ci.invalid' })).status,
          403,
        );
        const sessions = (
          await owner.query(
            "SELECT s.ssl,s.version FROM pg_stat_activity a JOIN pg_stat_ssl s USING(pid) WHERE a.usename='staging_ci_tls_runtime' AND a.datname='realtor_synthetic_ci'",
          )
        ).rows;
        assert.ok(sessions.length >= 1);
        assert.ok(sessions.every((s) => s.ssl === true && /^TLSv1\.[23]$/.test(s.version)));
        const result = await stop(c);
        assert.equal(result.code, 0);
        assert.equal(result.signal, null);
        const drainUntil = Date.now() + 3000;
        while (
          (
            await owner.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='staging_ci_tls_runtime' AND datname='realtor_synthetic_ci'",
            )
          ).rows[0].n !== 0
        ) {
          assert.ok(Date.now() < drainUntil, 'Owned API database connections did not drain.');
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        await stop(c);
      }
    },
  );
  t.diagnostic(
    'Owned compiled API/TLS rehearsal completed; inspect individual subtest outcomes above. Cloud Run, workload ADC, IAM and provider sign-in are not verified.',
  );
  // Fixture configuration only, not a pass receipt. CI must require the test step to succeed.
  await writeFile(
    join(runnerTemp, 'realtor-ci-tls-context.json'),
    JSON.stringify(
      {
        policy: 'owned-disposable-postgres-tls-v1',
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        containerId: container,
        caFile: join(directory, 'ca.crt'),
        apiDatabaseUrl: url.href,
        tenantId: tenant,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
}
