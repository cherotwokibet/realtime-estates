import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  assertEnquiryLaunchAvailable,
  enquiryLaunchConfiguration,
} from '../dev/enquiry-launch-config.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'realtor-enquiry-launch-'));
  assert.equal(dirname(root), tmpdir());
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function listening(t) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { server, port: String(server.address().port) };
}

test('enquiry launcher retains ordinary defaults and accepts an explicit separate UI port', () => {
  assert.deepEqual(enquiryLaunchConfiguration({}), {
    uiPort: '3001',
    apiPort: '4101',
    webPort: undefined,
  });
  assert.deepEqual(enquiryLaunchConfiguration({}, ['--web']), {
    uiPort: '3001',
    apiPort: '4101',
    webPort: '3002',
  });
  const env = { ENQUIRY_UI_PORT: '3005', ENQUIRY_API_PORT: '0', TENANT_SLUG: 'sample-homes' };
  const config = enquiryLaunchConfiguration(env, ['--web']);
  assert.deepEqual(config, { uiPort: '3005', apiPort: '0', webPort: '3002' });
  assert.ok(Object.isFrozen(config));
  assert.equal(env.TENANT_SLUG, 'sample-homes');
  assert.equal(enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: '1024' }).uiPort, '1024');
  assert.equal(enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: '65535' }).uiPort, '65535');
});

test('enquiry launcher rejects production, malformed ports and all requested port collisions', () => {
  assert.throws(() => enquiryLaunchConfiguration({ NODE_ENV: 'production' }));
  for (const port of ['', '0', '80', '1023', '65536', '03005', '3005x', '3005 ', '3e3', 3005])
    assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: port }));
  for (const port of ['', '00', '80', '1023', '65536', '04101', '4101x', '4101 ', '4e3', 4101])
    assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_API_PORT: port }));
  assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: '3002' }, ['--web']));
  assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: '4101' }));
  assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_API_PORT: '3002' }, ['--web']));
  assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_API_PORT: '3001' }));
  assert.equal(enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: '3002' }).uiPort, '3002');
});

test('enquiry journey launcher requires the exact trusted fixture while keeping a public UI optional', () => {
  const config = enquiryLaunchConfiguration({
    ENQUIRY_UI_PORT: '3005',
    ENQUIRY_API_PORT: '0',
    ENQUIRY_JOURNEY_FIXTURE: 'enquiry-queue-v1',
  });
  assert.deepEqual(config, {
    uiPort: '3005',
    apiPort: '0',
    webPort: undefined,
    journeyFixture: 'enquiry-queue-v1',
  });
  assert.ok(Object.isFrozen(config));
  assert.equal(
    enquiryLaunchConfiguration({ ENQUIRY_JOURNEY_FIXTURE: 'enquiry-queue-v1' }, ['--web']).webPort,
    '3002',
  );
  for (const value of ['', 'public-search-v1', 'Enquiry-queue-v1', 'enquiry-queue-v1 ', true])
    assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_JOURNEY_FIXTURE: value }));
  assert.throws(() =>
    enquiryLaunchConfiguration({
      NODE_ENV: 'production',
      ENQUIRY_JOURNEY_FIXTURE: 'enquiry-queue-v1',
    }),
  );
});

test('existing admin and requested web development locks refuse startup without touching them', async (t) => {
  const root = await fixture(t);
  for (const app of ['admin', 'web']) {
    const directory = join(root, 'apps', app, '.next', 'dev');
    await mkdir(directory, { recursive: true });
    const lock = join(directory, 'lock');
    await writeFile(lock, 'existing preview');
    const config = enquiryLaunchConfiguration({}, app === 'web' ? ['--web'] : []);
    await assert.rejects(() => assertEnquiryLaunchAvailable(config, root), /development directory/);
    assert.equal(await readFile(lock, 'utf8'), 'existing preview');
    await rm(lock);
  }
});

test('occupied admin, requested public or explicit API port refuses startup and leaves the listener intact', async (t) => {
  const root = await fixture(t);
  const { server, port } = await listening(t);
  await assert.rejects(
    () => assertEnquiryLaunchAvailable({ uiPort: port, apiPort: '0' }, root),
    /port is unavailable/,
  );
  assert.equal(server.listening, true);
  const { server: available, port: freePort } = await listening(t);
  await new Promise((resolve) => available.close(resolve));
  const publicOnly = { uiPort: freePort, webPort: port, apiPort: '0' };
  await assert.rejects(() => assertEnquiryLaunchAvailable(publicOnly, root), /port is unavailable/);
  assert.equal(server.listening, true);
  await assert.rejects(
    () => assertEnquiryLaunchAvailable({ uiPort: freePort, apiPort: port }, root),
    /port is unavailable/,
  );
  assert.equal(server.listening, true);
});

test('successful availability probe releases its socket for the actual launcher', async (t) => {
  const root = await fixture(t);
  const { server, port } = await listening(t);
  await new Promise((resolve) => server.close(resolve));
  const config = enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: port, ENQUIRY_API_PORT: '0' });
  await assertEnquiryLaunchAvailable(config, root);
  const next = createServer();
  t.after(() => new Promise((resolve) => next.close(resolve)));
  await new Promise((resolve, reject) => {
    next.once('error', reject);
    next.listen({ host: '127.0.0.1', port: Number(port), exclusive: true }, resolve);
  });
  assert.equal(next.listening, true);
});

test('an unrelated web dev lock does not block admin-only startup', async (t) => {
  const root = await fixture(t);
  const directory = join(root, 'apps', 'web', '.next', 'dev');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'lock'), 'existing public preview');
  const { server, port } = await listening(t);
  await new Promise((resolve) => server.close(resolve));
  await assertEnquiryLaunchAvailable(
    enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: port, ENQUIRY_API_PORT: '0' }),
    root,
  );
  assert.equal(await readFile(join(directory, 'lock'), 'utf8'), 'existing public preview');
});

test('the pilot starts both browser apps and rejects other fixture or fault settings', () => {
  assert.deepEqual(
    enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: '3071', ENQUIRY_API_PORT: '0' }, ['--pilot']),
    {
      uiPort: '3071',
      apiPort: '0',
      webPort: '3002',
      journeyFixture: 'web-admin-pilot-v1',
    },
  );
  assert.throws(() =>
    enquiryLaunchConfiguration({ ENQUIRY_JOURNEY_FIXTURE: 'enquiry-queue-v1' }, ['--pilot']),
  );
  assert.throws(() => enquiryLaunchConfiguration({}, ['--pilot', '--invalid-first-viewing-reply']));
  assert.throws(() => enquiryLaunchConfiguration({ ENQUIRY_UI_PORT: '3002' }, ['--pilot']));
});
