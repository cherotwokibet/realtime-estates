// Actual headless Chromium + production Next clients; synthetic intercepted API authority only.
// Never uses a personal browser profile, provider, account, database or paid service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await pause(70);
  }
  throw Error('Timed out: ' + label);
}
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tenant = id(1),
  actor = id(13),
  listing = id(200),
  csrf = 'c'.repeat(43);
const evidence = {
  policy: 'synthetic-browser-session-lifecycle-v1',
  tests: [],
  realProviderVerified: false,
  realDatabaseVerified: false,
  nativeDeviceVerified: false,
};
const children = [];
let socket;
const pending = new Map(),
  handlers = new Map();
let sequence = 0;
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const n = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(n);
      rej(Error('CDP timeout ' + method));
    }, 20000);
    pending.set(n, { res, rej, timer });
    socket.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function port() {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function start(app, review = false) {
  const p = await port(),
    env = { ...process.env, NODE_ENV: 'production', APP_ENV: 'staging' };
  for (const k of Object.keys(env))
    if (
      /^(FIREBASE_|BROWSER_IDENTITY_|STAFF_PREVIEW_|WEB_CUSTOMER_PREVIEW_CONFIG|HOSTED_CUSTOMER_|HOSTED_STAFF_|HOSTED_API_INVOCATION_)/.test(
        k,
      )
    )
      delete env[k];
  const projectId = 'realtor-synthetic-staging';
  env.FIREBASE_BROWSER_CONFIG = JSON.stringify({
    projectId,
    applicationOrigin: 'https://synthetic-browser.example',
    tenantId: tenant,
  });
  env.FIREBASE_WEB_CONFIG = JSON.stringify({
    projectId,
    apiKey: 'AIza' + 'x'.repeat(35),
    authDomain: projectId + '.firebaseapp.com',
    appId: '1:123456:web:abcdef123456',
  });
  env.BROWSER_IDENTITY_DATABASE_URL =
    'postgres://synthetic:synthetic-database-secret@127.0.0.1:1/identity?sslmode=verify-full';
  env.BROWSER_IDENTITY_STORAGE_KEY = 'ec'.repeat(32);
  if (!review)
    env[app === 'web' ? 'HOSTED_CUSTOMER_API_ORIGIN' : 'HOSTED_STAFF_API_ORIGIN'] =
      'https://synthetic-api.example';
  env.PRIVACY_NOTICE_VERSION = 'synthetic-staff-v1';
  if (review) env.STAFF_PREVIEW_INSTANCE = id(900); // Fixture scope only; production preview BFF stays disabled.
  const child = spawn(
    process.execPath,
    [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(p), '-H', '127.0.0.1'],
    { cwd: resolve(root, 'apps', app), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(child);
  let log = '';
  child.stdout.on('data', (b) => (log = (log + b).slice(-2000)));
  child.stderr.on('data', (b) => (log = (log + b).slice(-2000)));
  const origin = 'http://127.0.0.1:' + p;
  await until(
    async () => {
      if (child.exitCode !== null) throw Error(log);
      try {
        return (await fetch(origin + (review ? '/reviews' : '/sign-in'))).ok;
      } catch {
        return false;
      }
    },
    app + ' ready',
    40000,
  );
  return origin;
}
async function tab(origin, path, kind, model) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (m, p = {}) => send(m, p, s);
  const evaljs = async (expression) => {
    const r = await cmd('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  let reads = 0,
    held = null;
  const errors = [];
  async function fulfil(requestId, body, status = 200) {
    await cmd('Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      responseHeaders: [
        { name: 'content-type', value: 'application/json' },
        { name: 'cache-control', value: 'no-store' },
      ],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    });
  }
  function data(path) {
    const expiresAt = new Date(model.expiresAt).toISOString();
    if (path === '/auth/session')
      return { account: { actorId: actor, tenantId: tenant, expiresAt }, csrf };
    if (path === '/api/customer/session')
      return {
        policy: 'hosted-customer-browser-session-v1',
        account: {
          tenantId: tenant,
          customerId: actor,
          label: 'Your account',
          generation: 'a'.repeat(64),
          expiresAt,
        },
        csrf,
        pending: null,
        choices: [],
      };
    if (path === '/api/customer/favourites')
      return {
        page: {
          policy: 'customer-favourites-page-v1',
          tenantId: tenant,
          customerId: actor,
          items: [{ listingId: listing, version: '1', available: true }],
          hasMore: false,
        },
        summaries: [
          {
            listingId: listing,
            title: 'PRIVATE_HOME_CANARY',
            priceMinor: 100000,
            purpose: 'rent',
            rentalPeriod: 'month',
          },
        ],
      };
    if (path === '/api/hosted-staff/session')
      return {
        policy: 'hosted-staff-session-v1',
        account: { tenantId: tenant, actorId: actor, generation: 'a'.repeat(64), expiresAt },
        csrf,
        pending: null,
      };
    if (path === '/api/hosted-staff/branches')
      return {
        page: {
          policy: 'staff-branch-page-v1',
          items: [
            {
              policy: 'staff-branch-current-v1',
              branchId: id(300),
              version: '1',
              name: 'PRIVATE_BRANCH_CANARY',
              active: true,
              recordedAt: '2026-11-20T00:00:00.000Z',
            },
          ],
          nextAfter: null,
        },
      };
    if (path === '/api/staff/reviews')
      return {
        items: [
          {
            listingId: listing,
            revision: 1,
            version: '1',
            title: 'PRIVATE_QUEUE_CANARY',
            amountMinor: null,
            rentPeriod: null,
            submittedAt: null,
          },
        ],
      };
    if (path === '/api/staff/reviews/' + listing + '/1')
      return {
        listingId: listing,
        revision: 1,
        version: '1',
        listingVersion: '1',
        slug: 'private-fixture',
        state: 'pending',
        publicationStatus: 'draft',
        publishedRevision: null,
        availability: 'available',
        lastAvailabilityConfirmedAt: null,
        submittedAt: null,
        submittedBy: actor,
        decidedAt: null,
        decidedBy: null,
        decisionReason: null,
        acceptedPhotoCount: 0,
        photos: [],
        content: {
          title: 'PRIVATE_REVIEW_CANARY',
          description: 'Private submitted description',
          purpose: null,
          propertyType: null,
          bedrooms: null,
          privateBathrooms: null,
          sharedBathrooms: null,
          location: { area: null, town: null, county: null },
          locality: null,
          country: 'KE',
          publicPrecision: 'area',
          latitude: null,
          longitude: null,
          privateAddress: 'PRIVATE_ADDRESS_CANARY',
          amountMinor: null,
          rentPeriod: null,
          pricing: { declaration: 'incomplete', charges: [] },
        },
      };
    throw Error('Unexpected synthetic endpoint ' + path);
  }
  handlers.set(s, async (m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text);
      return;
    }
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    const u = new URL(request.url);
    if (u.origin !== origin) {
      await cmd('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      return;
    }
    if (!/^\/(auth\/|api\/customer\/|api\/hosted-staff\/|api\/staff\/reviews)/.test(u.pathname)) {
      await cmd('Fetch.continueRequest', { requestId });
      return;
    }
    if (/sign-out|logout/.test(u.pathname)) {
      model.logouts.push(() => fulfil(requestId, { error: 'synthetic-unconfirmed' }, 503));
      return;
    }
    reads++;
    if (u.pathname.endsWith('/media-gallery')) {
      await fulfil(
        requestId,
        { error: 'synthetic-gallery-unavailable' },
        model.galleryStatus ?? 503,
      );
      return;
    }
    if (model.reviewStatus && u.pathname.startsWith('/api/staff/reviews')) {
      await fulfil(requestId, { error: 'synthetic-access-denied' }, model.reviewStatus);
      return;
    }
    const body = data(u.pathname);
    if (model.hold && /favourites|branches|auth\/session|staff\/reviews\//.test(u.pathname)) {
      held = () => fulfil(requestId, body);
      return;
    }
    await fulfil(requestId, body);
  });
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cmd('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await cmd('Page.navigate', { url: origin + path });
  const selector =
    kind === 'review'
      ? '.review-workspace-layout'
      : kind === 'staff'
        ? '.hosted-staff'
        : kind === 'customer'
          ? '.customer-account'
          : '.hosted-sign-in';
  const privateText =
    kind === 'review'
      ? 'PRIVATE_REVIEW_CANARY'
      : kind === 'staff'
        ? 'PRIVATE_BRANCH_CANARY'
        : kind === 'customer'
          ? 'PRIVATE_HOME_CANARY'
          : 'You are signed in.';
  const text = () => evaljs(`document.querySelector(${JSON.stringify(selector)})?.innerText || ''`);
  const visible = async () => (await text()).includes(privateText);
  await until(visible, kind + ' private initial render');
  return {
    cmd,
    evaljs,
    text,
    visible,
    reads: () => reads,
    errors,
    held: () => held,
    click: async (label) =>
      evaljs(
        `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector + ' button')})].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Button unavailable');b.click();})()`,
      ),
    close: () => send('Target.closeTarget', { targetId }),
  };
}
try {
  await mkdir(resolve(root, '.staging-artifacts'), { recursive: true });
  const profile = await mkdtemp(resolve(root, '.staging-artifacts/session-browser470-'));
  let chrome = process.env.REALTOR_CHROME_PATH;
  if (!chrome) {
    for (const c of process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium'])
      try {
        await access(c);
        chrome = c;
        break;
      } catch {}
  }
  assert.ok(chrome, 'An installed Chromium is required; this check must never silently skip.');
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      'about:blank',
    ],
    { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  children.push(child);
  child.stderr.on('data', () => {});
  let endpoint;
  await until(async () => {
    try {
      const v = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split(/\r?\n/);
      endpoint = 'ws://127.0.0.1:' + v[0] + v[1];
      return true;
    } catch {
      return false;
    }
  }, 'owned headless browser');
  socket = new WebSocket(endpoint);
  await once(socket, 'open');
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.rej(Error(JSON.stringify(m.error))) : p.res(m.result);
    } else {
      const h = handlers.get(m.sessionId);
      if (h)
        h(m).catch((e) => {
          console.error(e);
          process.exitCode = 1;
        });
    }
  });
  evidence.browser = (await send('Browser.getVersion')).product;
  for (const app of ['web', 'admin']) {
    const origin = await start(app);
    for (const kind of app === 'web' ? ['customer', 'signin'] : ['staff', 'signin']) {
      const path = kind === 'customer' ? '/account' : kind === 'staff' ? '/' : '/sign-in';
      const model = { expiresAt: Date.now() + 120000, logouts: [], hold: false };
      const a = await tab(origin, path, kind, model),
        b = await tab(origin, path, kind, model);
      if (kind === 'staff') {
        await b.click('Edit branch');
        await b.evaljs(
          `(()=>{const inputs=[...document.querySelectorAll('.hosted-staff input')];for(const x of inputs.filter(x=>x.type==='text')){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(x,'PRIVATE_DRAFT_CANARY');x.dispatchEvent(new Event('input',{bubbles:true}));}})()`,
        );
      }
      if (kind === 'staff')
        assert.equal(
          await b.evaljs(
            `!![...document.querySelectorAll('.hosted-staff input')].find(x=>x.value==='PRIVATE_DRAFT_CANARY')`,
          ),
          true,
        );
      await a.click('Sign out');
      await until(async () => !(await b.visible()), kind + ' peer clear');
      await until(() => model.logouts.length === 1, 'pending logout request');
      const n = b.reads();
      await b.evaljs(
        `window.dispatchEvent(new Event('focus'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));document.dispatchEvent(new Event('visibilitychange'));`,
      );
      await pause(300);
      assert.equal(b.reads(), n, 'logout barrier must prevent background reauthentication');
      assert.equal(await b.visible(), false);
      assert.equal(await a.visible(), false);
      await model.logouts.shift()();
      await pause(300);
      assert.equal(await b.visible(), false);
      assert.equal(await a.visible(), false, 'failed logout stays cleared');
      assert.doesNotMatch(await b.text(), /PRIVATE_(HOME|BRANCH|DRAFT)_CANARY/);
      assert.equal(
        await b.evaljs(
          `!![...document.querySelectorAll('input,textarea')].find(x=>/PRIVATE_.*_CANARY/.test(x.value))`,
        ),
        false,
      );
      evidence.tests.push(
        app +
          '/' +
          kind +
          ': pending and failed logout clear both tabs; foreground/BFCache events do not reload',
      );
      const refresh =
        kind === 'customer'
          ? 'Refresh account'
          : kind === 'staff'
            ? 'Refresh branches and retained action'
            : 'Check sign-in';
      const clearedPeerReads = a.reads();
      await b.click(refresh);
      await until(b.visible, 'deliberate recheck');
      await pause(250);
      assert.equal(
        a.reads(),
        clearedPeerReads,
        'a deliberate check in one tab must not automatically reopen a cleared peer',
      );
      assert.equal(
        await a.visible(),
        false,
        'cleared peer remains locked until its own deliberate check',
      );
      // A notification never unlocks a cleared tab. Explicit recheck is local to its caller.
      await a.evaljs(
        `(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed'});c.close();})()`,
      );
      await until(async () => !(await b.visible()), 'legacy invalidation');
      const reads = b.reads();
      await pause(150);
      assert.equal(b.reads(), reads);
      await a.evaljs(
        `(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signed-in'});c.close();})()`,
      );
      await pause(250);
      assert.equal(
        await b.visible(),
        false,
        'sign-in notification must not unlock an invalidated tab',
      );
      assert.equal(b.reads(), reads, 'cleared tab does not automatically recheck');
      await b.click(refresh);
      await until(b.visible, 'explicit recheck after sign-in notification');
      assert.ok(b.reads() > reads);
      const activeReads = b.reads();
      await a.evaljs(
        `(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signed-in'});c.close();})()`,
      );
      await until(
        async () => b.reads() > activeReads && (await b.visible()),
        'active view rechecks changed authority',
      );
      {
        model.hold = true;
        await b.click(refresh);
        await until(() => b.held(), 'held private response');
        await a.evaljs(
          `(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signing-out'});c.close();})()`,
        );
        await pause(150);
        await b
          .held()()
          .catch(() => {});
        await pause(250);
        assert.equal(await b.visible(), false, 'late private response cannot repaint');
        model.hold = false;
        evidence.tests.push(
          app + '/' + kind + ': late private response discarded after logout invalidation',
        );
      }
      assert.deepEqual(a.errors, []);
      assert.deepEqual(b.errors, []);
      await a.close();
      await b.close();
      model.expiresAt = Date.now() + 3000;
      const exp = await tab(origin, path, kind, model);
      await until(async () => !(await exp.visible()), kind + ' session expiry', 10000);
      const count = exp.reads();
      await exp.evaljs(
        `window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));`,
      );
      await pause(200);
      assert.equal(exp.reads(), count);
      assert.equal(await exp.visible(), false);
      await exp.close();
      evidence.tests.push(
        app +
          '/' +
          kind +
          ': expiry and sign-in notifications cannot unlock cleared views; legacy messages fail closed; explicit checks are local',
      );
    }
    if (app === 'admin') {
      const reviewOrigin = await start('admin', true);
      const path = '/reviews?listingId=' + listing + '&revision=1';
      const model = { expiresAt: Date.now() + 120000, logouts: [], hold: false };
      const a = await tab(reviewOrigin, path, 'review', model),
        b = await tab(reviewOrigin, path, 'review', model);
      await b.evaljs(
        `(()=>{const x=document.querySelector('.review-workspace-layout textarea');if(!x)throw Error('Missing review reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(x,'PRIVATE_REASON_CANARY');x.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      assert.equal(
        await b.evaljs(`document.querySelector('textarea').value`),
        'PRIVATE_REASON_CANARY',
      );
      model.hold = true;
      await b.click('Check latest review');
      await until(() => b.held(), 'held review refresh');
      await a.evaljs(
        `(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signing-out'});c.close();})()`,
      );
      await until(
        async () => !(await a.visible()) && !(await b.visible()),
        'review tabs clear immediately',
      );
      await b
        .held()()
        .catch(() => {});
      await pause(200);
      const count = b.reads();
      await b.evaljs(
        `window.dispatchEvent(new Event('focus'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signed-in'});c.close();})()`,
      );
      await pause(200);
      assert.equal(b.reads(), count);
      assert.doesNotMatch(await b.text(), /PRIVATE_(REVIEW|QUEUE|ADDRESS|REASON)_CANARY/);
      assert.equal(
        await b.evaljs(`!!document.querySelector('.review-workspace-layout textarea')`),
        false,
      );
      assert.equal(
        await b.evaljs(
          `!![...document.querySelectorAll('.review-workspace-layout button')].find(x=>x.textContent.includes('Approve synthetic'))`,
        ),
        false,
      );
      assert.deepEqual(a.errors, []);
      assert.deepEqual(b.errors, []);
      await a.close();
      await b.close();
      evidence.tests.push(
        'admin/review: two-tab logout clears cards/address/reason/media subtree; late refresh and sign-in hints cannot restore or dispatch cached decisions',
      );
      for (const status of [401, 403]) {
        const denied = { expiresAt: Date.now() + 120000, logouts: [], hold: false };
        const c = await tab(reviewOrigin, path, 'review', denied);
        denied.reviewStatus = status;
        await c.click('Check latest review');
        await until(async () => !(await c.visible()), 'review denial ' + status);
        assert.doesNotMatch(await c.text(), /PRIVATE_(REVIEW|QUEUE|ADDRESS)_CANARY/);
        const n = c.reads();
        await c.click('Refresh queue');
        await pause(150);
        assert.equal(c.reads(), n, 'locked preview cannot dispatch another private request');
        assert.deepEqual(c.errors, []);
        await c.close();
        evidence.tests.push(
          'admin/review: HTTP ' +
            status +
            ' clears loaded private content and blocks further preview requests',
        );
      }
      const media = { expiresAt: Date.now() + 120000, logouts: [], hold: false };
      const c = await tab(reviewOrigin, path, 'review', media);
      media.galleryStatus = 403;
      await c.click('Check latest review');
      await until(async () => !(await c.visible()), 'gallery denial clears parent review');
      assert.doesNotMatch(await c.text(), /PRIVATE_(REVIEW|QUEUE|ADDRESS)_CANARY/);
      assert.deepEqual(c.errors, []);
      await c.close();
      evidence.tests.push('admin/review: denied gallery clears the containing private review');
      const hidden = { expiresAt: Date.now() + 120000, logouts: [], hold: false };
      const d = await tab(reviewOrigin, path, 'review', hidden);
      await d.evaljs(`window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));`);
      await until(async () => !(await d.visible()), 'review pagehide clear');
      assert.doesNotMatch(await d.text(), /PRIVATE_(REVIEW|QUEUE|ADDRESS)_CANARY/);
      assert.deepEqual(d.errors, []);
      await d.close();
      evidence.tests.push(
        'admin/review: pagehide removes private rendering before a persisted-page restore',
      );
    }
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (socket?.readyState === 1) {
    await send('Browser.close').catch(() => {});
    socket.close();
  }
  for (const p of children.reverse()) {
    if (p.exitCode === null) {
      p.kill();
      await Promise.race([once(p, 'exit'), pause(3000)]);
    }
  }
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.rej(Error('Browser closed'));
  }
  pending.clear();
}
