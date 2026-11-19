import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { join, basename, sep } from 'node:path';
import { randomUUID, X509Certificate } from 'node:crypto';

const postgresImage =
  'postgres:17-bookworm@sha256:837bed18782820fe967067cb5328b02b0d9992c1be9a37ee0c9c492cfc03af3b';
export async function verifyApiContainerBootstrap(image, sourceCommit) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.REALTOR_POSTGRES_TEST_POLICY, 'owned-disposable-ci-v1');
  const temp = await realpath(process.env.RUNNER_TEMP ?? '');
  assert.ok(temp.startsWith('/'));
  const file = await realpath(join(temp, 'realtor-ci-tls-context.json'));
  assert.ok(file.startsWith(temp + sep));
  const raw = await readFile(file, 'utf8');
  assert.ok(raw.length < 8192);
  const context = JSON.parse(raw);
  assert.deepEqual(
    Object.keys(context).sort(),
    ['policy', 'sourceCommit', 'containerId', 'caFile', 'apiDatabaseUrl', 'tenantId'].sort(),
  );
  assert.equal(context.policy, 'owned-disposable-postgres-tls-v1');
  assert.equal(context.sourceCommit, sourceCommit);
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(context.containerId, /^[a-f0-9]{64}$/);
  assert.equal(context.containerId, process.env.REALTOR_POSTGRES_TEST_CONTAINER);
  assert.equal(context.tenantId, '00000000-0000-4000-8000-000000000001');
  assert.equal(
    context.apiDatabaseUrl,
    'postgresql://staging_ci_tls_runtime:synthetic-ci-tls-only@localhost:5432/realtor_synthetic_ci?sslmode=verify-full',
  );
  const ca = await realpath(context.caFile);
  assert.ok(ca.startsWith(temp + sep));
  assert.equal(basename(ca), 'ca.crt');
  const pem = await readFile(ca, 'utf8');
  assert.doesNotMatch(pem, /PRIVATE KEY/);
  assert.equal(new X509Certificate(pem).ca, true);
  assert.equal(image.tag, 'realtor-ci-api:' + sourceCommit.slice(0, 12));
  assert.match(image.id, /^sha256:[a-f0-9]{64}$/);
  const docker = (args, env = {}) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 16384,
      env: { ...process.env, ...env },
    });
  assert.equal(docker(['image', 'inspect', '--format', '{{.Id}}', image.tag]).trim(), image.id);
  const pg = JSON.parse(docker(['inspect', context.containerId]))[0];
  assert.equal(pg.Config.Image, postgresImage);
  assert.equal(pg.State.Running, true);
  const config = {
    policy: 'realtor-staging-api-v1',
    projectId: 'realtor-synthetic-staging',
    tenantId: context.tenantId,
    applicationOrigin: 'https://api.realtor-ci.invalid',
    privacyNoticeVersion: 'synthetic-ci-v1',
  };
  const fake = {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    PORT: '8080',
    K_SERVICE: 'synthetic-ci-not-cloud-run',
    GOOGLE_CLOUD_PROJECT: config.projectId,
    HOSTED_API_CONFIG: JSON.stringify(config),
    HOSTED_API_DATABASE_URL: context.apiDatabaseUrl,
    NODE_EXTRA_CA_CERTS: '/run/realtor-ci-ca.crt',
  };
  const common = [
    '--init',
    '--pull=never',
    '--memory=512m',
    '--cpus=1',
    '--network',
    'container:' + context.containerId,
    '--mount',
    'type=bind,source=' + ca + ',target=/run/realtor-ci-ca.crt,readonly',
  ];
  // Exact fixed-name synthetic settings only; no runner/provider environment is forwarded.
  const environmentArgs = Object.keys(fake).flatMap((k) => ['--env', k]);
  const privileged = new URL(context.apiDatabaseUrl);
  privileged.username = 'postgres';
  privileged.password = 'synthetic-ci-admin-only';
  const refusedName = 'realtor-ci-api-privileged-' + randomUUID();
  try {
    docker(['run', '--rm', '--name', refusedName, ...common, ...environmentArgs, image.tag], {
      ...fake,
      HOSTED_API_DATABASE_URL: privileged.href,
    });
    assert.fail('Privileged API image startup succeeded.');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /Staging API startup failed\./);
  } finally {
    // Usually already auto-removed; on a failed/timed-out assertion stop only this owned UUID.
    try {
      docker(['stop', '--time', '2', refusedName]);
    } catch {}
  }
  const name = 'realtor-ci-api-positive-' + randomUUID();
  let created = false;
  const healthScript = `import{request}from'node:http';if(process.getuid()===0)throw Error('Non-root API required.');async function get(headers={}){return new Promise((resolve,reject)=>{const r=request({hostname:'127.0.0.1',port:8080,path:'/healthz',agent:false,headers:{host:'api.realtor-ci.invalid',connection:'close',...headers},timeout:1500},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,cache:res.headers['cache-control'],body}));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('Health timed out.')));r.end();});}console.log(JSON.stringify({uid:process.getuid(),healthy:await get(),wrongHost:await get({host:'untrusted.realtor-ci.invalid'}),forgedActor:await get({'x-actor-id':'synthetic-forged-actor'}),foreignOrigin:await get({origin:'https://untrusted.realtor-ci.invalid'})}));`;
  const sessions = () =>
    JSON.parse(
      docker([
        'exec',
        '--user',
        'postgres',
        context.containerId,
        'psql',
        '--no-psqlrc',
        '-U',
        'postgres',
        '-d',
        'realtor_synthetic_ci',
        '-t',
        '-A',
        '-c',
        "SELECT coalesce(json_agg(json_build_object('ssl',s.ssl,'version',s.version)),'[]'::json) FROM pg_stat_activity a JOIN pg_stat_ssl s USING(pid) WHERE a.usename='staging_ci_tls_runtime' AND a.datname='realtor_synthetic_ci'",
      ]).trim(),
    );
  try {
    const id = docker(
      ['run', '--detach', '--name', name, ...common, ...environmentArgs, image.tag],
      fake,
    ).trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    created = true;
    let health;
    const readyUntil = Date.now() + 15000;
    while (!health) {
      const state = JSON.parse(docker(['inspect', name]))[0];
      assert.equal(
        state.State.Running,
        true,
        'API image exited before readiness: ' + docker(['logs', name]),
      );
      assert.ok(Date.now() < readyUntil, 'API image startup timed out.');
      try {
        health = JSON.parse(
          docker(['exec', name, 'node', '--input-type=module', '-e', healthScript]),
        );
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    const info = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(info.Config.User, 'node');
    assert.equal(info.HostConfig.Memory, 512 * 1024 * 1024);
    assert.equal(info.HostConfig.NanoCpus, 1e9);
    assert.equal(info.HostConfig.NetworkMode, 'container:' + context.containerId);
    assert.notEqual(health.uid, 0);
    assert.deepEqual(health.healthy, { status: 200, cache: 'no-store', body: '{"status":"ok"}' });
    assert.equal(health.wrongHost.status, 400);
    assert.equal(health.forgedActor.status, 400);
    assert.equal(health.foreignOrigin.status, 403);
    const encrypted = sessions();
    assert.ok(encrypted.length >= 1);
    assert.ok(encrypted.every((s) => s.ssl === true && /^TLSv1\.[23]$/.test(s.version)));
    docker(['stop', '--time', '12', name]);
    const stopped = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(stopped.State.ExitCode, 0);
    assert.equal(stopped.State.OOMKilled, false);
    const until = Date.now() + 3000;
    while (sessions().length) {
      assert.ok(Date.now() < until, 'API image SQL sessions did not drain.');
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      sourceCommit,
      imageId: image.id,
      nonRoot: true,
      memoryLimitBytes: 512 * 1024 * 1024,
      cpuLimit: 1,
      healthEnvelopeCasesPassed: 4,
      apiPositiveDatabaseStartupVerified: true,
      certificateVerifiedPostgresTls: true,
      privilegedDatabaseLoginRefused: true,
      gracefulSigtermAndSqlDrainVerified: true,
      cloudRunVerified: false,
      googleAdcOrIamVerified: false,
      providerSignInVerified: false,
    };
  } finally {
    if (created) {
      const state = JSON.parse(docker(['inspect', name]))[0];
      if (state.State.Running) docker(['stop', '--time', '12', name]);
      docker(['rm', name]);
    }
  }
}
