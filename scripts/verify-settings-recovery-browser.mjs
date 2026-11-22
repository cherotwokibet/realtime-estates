/** Actual owned Chromium + unproxied Next/API/file-backed SQL restart rehearsal. Synthetic only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { access, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeOwnedSettingsRecovery } from './settings-recovery-preview.mjs';
import { ownedLedgerRoot } from '../apps/api/dev/recovery-ledger-preview.mjs';
import { ledgerTestProtection } from '../apps/admin/tests/helpers/recovery-ledger-protection.mjs';
import { randomBytes } from 'node:crypto';
const arguments491 = process.argv.slice(2);
assert.ok(
  arguments491.length === 0 || (arguments491.length === 1 && arguments491[0] === '--stdout-only'),
  'Unsupported browser rehearsal option.',
);
const stdoutOnly491 = arguments491.length === 1;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error('Timed out: ' + label);
}
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((r) => server.close(r));
  return value;
}
let preview, chrome, socket, bundle;
const pending = new Map();
let serial = 0,
  session;
let worker, launchOptions;
const workerPath = fileURLToPath(
  new URL('../apps/admin/tests/helpers/settings-browser-worker.mjs', import.meta.url),
);
let ipcId = 0;
const ipcPending = new Map();
function rpc(action, fields = {}) {
  return new Promise((resolve, reject) => {
    const id = ++ipcId,
      timer = setTimeout(() => {
        ipcPending.delete(id);
        reject(Error('Owned launcher IPC deadline.'));
      }, 60000);
    ipcPending.set(id, { resolve, reject, timer });
    worker.send({ id, action, ...fields });
  });
}
async function stopWorker() {
  if (!worker) return;
  const active = worker;
  try {
    await rpc('close');
  } finally {
    const exited = once(active, 'exit');
    active.disconnect();
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            active.kill();
            resolve();
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      worker = null;
    }
  }
}
async function startWorker(membershipRole) {
  worker = spawn(process.execPath, [workerPath], {
    env: { ...process.env, NODE_ENV: 'development' },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  worker.on('message', (m) => {
    const entry = ipcPending.get(m.id);
    if (!entry) return;
    ipcPending.delete(m.id);
    clearTimeout(entry.timer);
    m.ok ? entry.resolve(m.value) : entry.reject(Error('Owned launcher worker failed.'));
  });
  worker.on('error', () => {
    for (const entry of ipcPending.values()) {
      clearTimeout(entry.timer);
      entry.reject(Error('Owned launcher process failed.'));
    }
    ipcPending.clear();
  });
  return rpc('start', {
    options: {
      ...launchOptions,
      ...(membershipRole ? { membershipRole } : {}),
      initialize: membershipRole === null,
    },
  });
}
const wire = [];
const checks = [];
function send(method, params = {}, sessionId = session) {
  return new Promise((resolve, reject) => {
    const id = ++serial,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('CDP deadline: ' + method));
      }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) throw Error('Owned browser evaluation failed.');
  return r.result.value;
}
const storage =
  "Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('realtor.sealed-recovery.v1:settings:')))";
const visible = 'document.body.innerText';
const pendingVisible =
  '!!document.querySelector(\'section[aria-label="Original operation recovery"]\')';
async function click(label) {
  assert.equal(
    await evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true;})()`,
    ),
    true,
    'Enabled ' + label,
  );
}
async function reload() {
  await evaluate('globalThis.__ownedReloadMarker = crypto.randomUUID()');
  await send('Page.reload', { ignoreCache: true });
  await until(async () => {
    try {
      return await evaluate(
        "!Object.hasOwn(globalThis, '__ownedReloadMarker') && document.readyState === 'complete'",
      );
    } catch {
      return false;
    }
  }, 'fresh document after reload');
}
try {
  const testWrappingKey =
    process.platform === 'win32' ? undefined : randomBytes(32).toString('hex');
  const custodyOptions = ledgerTestProtection(testWrappingKey);
  bundle = await initializeOwnedSettingsRecovery(custodyOptions);
  launchOptions = {
    ...bundle,
    policy: 'owned-settings-rehearsal-v1',
    port: await port(),
    loseFirstReply: true,
    testWrappingKey,
  };
  let current = await startWorker(null);
  preview = {
    get current() {
      return current;
    },
    inspect: () => rpc('inspect'),
    writes: async () => (await rpc('inspect')).writes,
    restart: async (controls = {}) => {
      await stopWorker();
      current = await startWorker(controls.membershipRole);
      return current;
    },
    close: stopWorker,
  };
  let executable = process.env.CHROME_PATH;
  if (!executable) {
    for (const candidate of process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium']) {
      try {
        await access(candidate);
        executable = candidate;
        break;
      } catch {}
    }
  }
  assert.ok(executable, 'Installed Chromium required; no silent skip.');
  const profile = join(bundle.root, 'browser-profile');
  await mkdir(profile);
  chrome = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      ...(process.platform === 'win32' ? [] : ['--no-sandbox']),
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let endpoint;
  await until(async () => {
    try {
      const rows = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split(/\r?\n/);
      endpoint = 'ws://127.0.0.1:' + rows[0] + rows[1];
      return true;
    } catch {
      return false;
    }
  }, 'owned Chromium');
  socket = new WebSocket(endpoint);
  await once(socket, 'open');
  socket.addEventListener('message', (event) => {
    const m = JSON.parse(event.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.reject(Error('Owned CDP command refused.')) : p.resolve(m.result);
    } else if (m.method === 'Page.javascriptDialogOpening') {
      void send('Page.handleJavaScriptDialog', { accept: true }, m.sessionId).catch(() => {});
    } else if (m.method === 'Network.responseReceived') {
      const u = new URL(m.params.response.url);
      if (u.origin === preview.current.origin && u.pathname.startsWith('/api/'))
        wire.push({ path: u.pathname, status: m.params.response.status });
    }
  });
  const browser = (await send('Browser.getVersion', {}, undefined)).product,
    target = (await send('Target.createTarget', { url: 'about:blank' }, undefined)).targetId;
  session = (await send('Target.attachToTarget', { targetId: target, flatten: true }, undefined))
    .sessionId;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: preview.current.origin + '/settings' });
  await until(
    () =>
      evaluate(
        "!![...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Company name'))?.querySelector('input:not(:disabled)')",
      ),
    'fresh authorized settings form',
  );
  checks.push('Actual unproxied Next settings form waits for signed current authority.');
  const canary = 'PRIVATE_RESTART491_CANARY';
  assert.equal(
    await evaluate(
      `(()=>{for(const [label,value] of [['Company name','Synthetic restart agency'],['Short summary',${JSON.stringify(canary)}]]){const l=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)),e=l?.querySelector('input,textarea');if(!e)return false;Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()`,
    ),
    true,
  );
  await evaluate("document.querySelector('.settings-check input').click()");
  await until(
    () =>
      evaluate(
        "!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Approve and save content'&&!b.disabled)",
      ),
    'approved save enabled',
  );
  await click('Approve and save content');
  await until(() => evaluate(pendingVisible), 'retained uncertain original');
  await until(
    async () =>
      wire.some((r) => r.path.startsWith('/api/company-settings/operations/') && r.status === 502),
    'actual malformed committed reply',
  );
  const retained = await evaluate(storage);
  assert.equal(Object.keys(retained).length, 1);
  assert.ok(!JSON.stringify(retained).includes(canary));
  const raw = Object.values(retained)[0],
    envelope = JSON.parse(raw);
  assert.equal(envelope.kind, 'settings');
  const firstLedger = await preview.inspect();
  assert.equal(firstLedger.count, 1);
  checks.push(
    'Committed malformed reply502 retains ciphertext-only original in actual sessionStorage.',
  );
  const before = preview.current;
  assert.equal((await rpc('refuse-control', { root: bundle.root })).refused, true);
  assert.equal(preview.current.nextPid, before.nextPid);
  await preview.restart();
  assert.notEqual(preview.current.nextPid, before.nextPid);
  assert.notEqual(preview.current.launcherPid, before.launcherPid);
  assert.notEqual(preview.current.signingFingerprint, before.signingFingerprint);
  await reload();
  await until(
    () => evaluate(pendingVisible),
    'same-tab retained original after full local restart',
  );
  assert.deepEqual(await evaluate(storage), retained);
  assert.ok((await evaluate(visible)).includes(envelope.operationId));
  assert.equal((await preview.inspect()).count, 1);
  assert.equal(await preview.writes(), 0);
  checks.push(
    'Fresh Next/API authority and same persistent ledger restore the exact tab capsule without automatic mutation.',
  );
  await preview.restart({ membershipRole: 'agent' });
  await reload();
  await until(
    async () => (await evaluate(visible)).includes('Company settings unavailable'),
    'current SQL role denial',
  );
  assert.ok(!(await evaluate(visible)).includes(canary));
  assert.deepEqual(await evaluate(storage), retained);
  assert.equal(await preview.writes(), 0);
  checks.push(
    'Current role denial after restart hides private original and preserves ciphertext without writes.',
  );
  await preview.restart({ membershipRole: 'admin' });
  await reload();
  await until(() => evaluate(pendingVisible), 'fresh restored admin authority');
  assert.deepEqual(await evaluate(storage), retained);
  assert.equal(await preview.writes(), 0);
  checks.push(
    'Restored current admin explicitly reopens the same original without changing its operation or key namespace.',
  );
  await click('Inspect original result');
  await until(
    async () =>
      !(await evaluate(pendingVisible)) && Object.keys(await evaluate(storage)).length === 0,
    'exact receipt confirmed release',
  );
  const finalLedger = await preview.inspect();
  assert.equal(finalLedger.count, 1);
  assert.equal(finalLedger.receiptDigest, firstLedger.receiptDigest);
  assert.equal(await preview.writes(), 0);
  assert.ok((await evaluate(visible)).includes('Current saved version 1 loaded.'));
  checks.push(
    'Original result GET confirms the immutable receipt, releases matching capsule and leaves one ledger record with no replay POST.',
  );
  await reload();
  await until(
    async () =>
      (await evaluate(visible)).includes('Company content and branding') &&
      !(await evaluate(pendingVisible)),
    'post-confirmation reload',
  );
  assert.equal(Object.keys(await evaluate(storage)).length, 0);
  assert.equal((await preview.inspect()).count, 1);
  checks.push(
    'Confirmed release remains clear after reload and does not generate another operation.',
  );
  const evidence = {
    policy: 'owned-next-settings-restart-browser-v1',
    browser,
    tests: checks,
    protection:
      process.platform === 'win32' ? 'windows-current-user-dpapi-v1' : 'owned-disposable-test-v1',
    networkInterceptionUsed: false,
    actualFileBackedPGlite: true,
    actualNextAndSignedApi: true,
    settingsLedgerRows: 1,
    wire,
    gracefulSqlApiRestartVerified: true,
    actualApiLauncherProcessRestartVerified: true,
    actualNextProcessRestartVerified: true,
    freshDocumentAfterEachReloadVerified: true,
    powerLossOrCrashVerified: false,
    closedTabRestoreVerified: false,
    managedProviderVerified: false,
    nativeDeviceVerified: false,
    plaintextMigrationVerified: false,
  };
  if (!stdoutOnly491)
    await writeFile(
      new URL('../docs/evidence/2026-11-22-restart491-browser.json', import.meta.url),
      JSON.stringify(evidence, null, 2) + '\n',
    );
  console.log(JSON.stringify(evidence));
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await send('Browser.close', {}, null).catch(() => {});
    socket.close();
  }
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error('Owned browser closed.'));
  }
  pending.clear();
  if (chrome && chrome.exitCode === null) {
    chrome.kill();
    await once(chrome, 'exit').catch(() => {});
  }
  await preview?.close();
  if (bundle) {
    await ownedLedgerRoot(bundle.root);
    await rm(bundle.root, { recursive: true, force: false });
  }
}
