// Actual headless Chromium + production Next clients; synthetic intercepted API authority only.
// Never uses a personal browser profile, provider, account, database or paid service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import * as creationFixture from '../packages/api-client/tests/fixtures/reference-creation.mjs';
import * as successorFixture from '../packages/api-client/tests/fixtures/reference-successor.mjs';
import { staffListingFixture } from '../packages/domain/test-helpers/staff-listing-fixtures.mjs';
import { openReferenceCreationEntry } from '../apps/admin/lib/reference-creation-entry.ts';
import { referenceSuccessorSession } from '../apps/admin/lib/reference-successor-workspace.ts';

import {
  prepareStaffWrite,
  markStaffWriteUncertain,
  serializeStaffWrite,
} from '../apps/admin/lib/staff-write-attempt.ts';
import { mkdtemp, readFile, access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Fixture-only loading of source store protocols; no test-dist build or application bypass.
// Transpile TS parameter properties using the repository's installed compiler, without writing files.
const fixtureLibRoot = new URL('../apps/admin/lib/', import.meta.url).href;
registerHooks({
  load(url, context, next) {
    if (url.startsWith(fixtureLibRoot) && url.endsWith('.ts'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    return next(url, context);
  },
});
const { creationAllocationSession, successorAllocationSession } =
  await import('../apps/admin/lib/allocation-recovery.ts');

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
let socket, referenceServer;
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
      /^(FIREBASE_|BROWSER_IDENTITY_|STAFF_PREVIEW_|PRIVATE_RECOVERY_|WEB_CUSTOMER_PREVIEW_CONFIG|HOSTED_CUSTOMER_|HOSTED_STAFF_|HOSTED_API_INVOCATION_)/.test(
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
  if (review === 'references' || review === 'ordinary') {
    // Production client bundle, explicitly developer-mode fixture server/BFF policy.
    // No production-policy override is added to application code.
    if (!referenceServer) {
      referenceServer = httpServer((req, res) => {
        let body;
        if (req.method !== 'GET') {
          res.writeHead(405);
          res.end();
          return;
        }
        if (req.url === '/v2/staff/session')
          body = { policy: 'current-staff-session-v2', tenantId: tenant, actorId: actor };
        else if (req.url?.startsWith('/v2/staff/branches?'))
          body = { policy: 'staff-branch-page-v1', items: [], nextAfter: null };
        else if (req.url?.startsWith('/v2/staff/invitation-requests?'))
          body = { policy: 'staff-invitation-page-v1', items: [], nextAfter: null };
        else if (req.url === '/v3/staff/reference-session')
          body = { policy: 'synthetic-reference-session-v1', tenantId: tenant, actorId: actor };
        else if (req.url?.includes('/reference-catalogues/')) body = creationFixture.catalogue();
        else if (req.url === '/v2/staff/listings/' + listing) {
          const row = staffListingFixture(200);
          body = {
            ...row,
            version: '1',
            publicationStatus: 'unpublished',
            publishedRevision: null,
            latest: { ...row.latest, revision: 1, version: '4', state: 'rejected' },
          };
        } else {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
      });
      referenceServer.listen(0, '127.0.0.1');
      await once(referenceServer, 'listening');
    }
    Object.assign(env, {
      NODE_ENV: 'development',
      STAFF_PREVIEW_MODE: 'synthetic',
      STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:' + referenceServer.address().port,
      STAFF_PREVIEW_TOKEN: 'synthetic.fixture.signature',
      STAFF_PREVIEW_INSTANCE: id(900),
      ...(review === 'references'
        ? {
            STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
            STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
            STAFF_PREVIEW_REFERENCE_CREATION: 'synthetic-reference-creation-v1',
            STAFF_PREVIEW_REFERENCE_SUCCESSOR: 'synthetic-reference-successor-v1',
          }
        : { STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1' }),
    });
  }
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
    held = null,
    leaseHeld = null;
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
        acceptedPhotoCount: model.liveMedia ? 4 : 0,
        photos: model.liveMedia
          ? Array.from({ length: 4 }, (_, i) => ({
              key: 'synthetic/fixture/' + i + '.webp',
              alt: 'Private fixture ' + i,
            }))
          : [],
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
    if (u.pathname.startsWith('/api/private-workspace/lease/')) {
      reads++;
      const when = Date.now();
      const body = {
        policy: 'staff-access-lease-v1',
        tenantId: model.leaseTenant ?? tenant,
        actorId: model.leaseActor ?? actor,
        role: model.leaseRole ?? 'admin',
        checkedAt: new Date(when).toISOString(),
        expiresAt: new Date(
          Math.min(model.leaseExpiresAt ?? when + 30000, when + 30000),
        ).toISOString(),
      };
      const complete = () =>
        fulfil(
          requestId,
          model.leaseStatus ? { error: 'synthetic-lease-denied' } : body,
          model.leaseStatus ?? 200,
        );
      if (model.holdLease) leaseHeld = complete;
      else await complete();
      return;
    }
    if (
      model.ordinaryKind &&
      (/^\/api\/staff\/listings\//.test(u.pathname) ||
        u.pathname.startsWith('/api/staff-directory/'))
    ) {
      reads++;
      const command = model.ordinaryCommand;
      let body;
      if (model.ordinaryKind === 'directory')
        body = {
          record: {
            ...command,
            policy: 'staff-branch-record-v1',
            actorId: actor,
            version: '1',
            outcome: 'applied',
            recordedAt: '2026-11-21T17:00:00.000Z',
          },
        };
      else if (model.ordinaryKind === 'allocation-creation')
        body = {
          listingId: command.listingId,
          operationId: command.operationId,
          actorId: actor,
          kind: 'create_listing',
          request: { slug: command.slug, content: command.content },
          outcome: 'created',
          reason: null,
          result: { listingVersion: '1', revision: 1, revisionVersion: '2' },
          completedAt: '2026-11-21T17:00:00.000Z',
        };
      else
        body = {
          listingId: command.listingId,
          operationId: command.operationId,
          actorId: actor,
          kind: 'start_revision',
          request: {
            expectedListingVersion: command.expectedListingVersion,
            predecessor: command.predecessor,
            content: command.content,
          },
          decision: {
            outcome: 'applied',
            reason: null,
            result: { listingVersion: '2', revision: 2, revisionVersion: '2' },
          },
          completedAt: '2026-11-21T17:00:00.000Z',
        };
      const complete = () =>
        fulfil(
          requestId,
          model.ordinaryStatus
            ? { error: 'SYNTHETIC_ACCESS_DENIED', submissionUncertain: false }
            : body,
          model.ordinaryStatus ?? 200,
        );
      if (model.holdOrdinary) held = complete;
      else await complete();
      return;
    }
    if (
      model.referenceKind &&
      /^\/api\/staff\/(reference-catalogues|listings)\//.test(u.pathname)
    ) {
      reads++;
      let body = creationFixture.catalogue();
      if (u.pathname.includes('-operations/')) {
        const input = JSON.parse(request.postData);
        body = (model.referenceKind === 'creation' ? creationFixture : successorFixture).receipt(
          input,
          creationFixture.catalogue(),
          actor,
        );
      }
      const complete = () =>
        fulfil(
          requestId,
          model.referenceStatus ? { submissionUncertain: true } : body,
          model.referenceStatus ?? 200,
        );
      if (model.holdReference) held = complete;
      else await complete();
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
    if (/\/media\/[^/]+\/preview$/.test(u.pathname)) {
      const image = () =>
        cmd('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'content-type', value: 'image/webp' },
            {
              name: 'content-length',
              value: String(
                Buffer.from(
                  'UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoCAAIAAUAmJYgCdLoAA5gA/vmo7+1Niqnnd+hRsol8wAAA',
                  'base64',
                ).length,
              ),
            },
            { name: 'x-revision-version', value: '1' },
            { name: 'cache-control', value: 'no-store' },
          ],
          body: 'UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoCAAIAAUAmJYgCdLoAA5gA/vmo7+1Niqnnd+hRsol8wAAA',
        });
      if (model.holdImages) model.imageWaiters.push(image);
      else await image();
      return;
    }
    if (u.pathname.endsWith('/media-gallery')) {
      if (model.liveMedia)
        await fulfil(requestId, {
          kind: 'review_media_gallery',
          listingId: listing,
          revision: 1,
          version: '1',
          state: 'pending',
          photos: Array.from({ length: 4 }, (_, i) => ({
            id: id(100 + i),
            alt: 'Private fixture ' + i,
            position: i,
          })),
        });
      else
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
  if (model.originalEntries)
    await cmd('Page.addScriptToEvaluateOnNewDocument', {
      source: `for(const [k,v] of ${JSON.stringify(model.originalEntries)})sessionStorage.setItem(k,v);`,
    });
  await cmd('Page.navigate', { url: origin + path });
  const selector =
    kind === 'directory'
      ? '.staff-workspace'
      : kind.startsWith('allocation-')
        ? '.draft-panel[aria-label="Retained listing allocation workspace"]'
        : kind === 'creation' || kind === 'successor'
          ? '.draft-panel[aria-label="Reference ' + kind + ' workspace"]'
          : kind === 'review'
            ? '.review-workspace-layout'
            : kind === 'staff'
              ? '.hosted-staff'
              : kind === 'customer'
                ? '.customer-account'
                : '.hosted-sign-in';
  const privateText =
    kind === 'directory' || kind.startsWith('allocation-')
      ? 'PRIVATE_STAFF_ORIGINAL_CANARY'
      : kind === 'creation' || kind === 'successor'
        ? 'PRIVATE_ORIGINAL_CANARY'
        : kind === 'review'
          ? 'PRIVATE_REVIEW_CANARY'
          : kind === 'staff'
            ? 'PRIVATE_BRANCH_CANARY'
            : kind === 'customer'
              ? 'PRIVATE_HOME_CANARY'
              : 'You are signed in.';
  const text = () => evaljs(`document.querySelector(${JSON.stringify(selector)})?.innerText || ''`);
  const visible = async () => (await text()).includes(privateText);
  if (!model.allowChecking) await until(visible, kind + ' private initial render');
  return {
    cmd,
    evaljs,
    text,
    visible,
    reads: () => reads,
    errors,
    held: () => held,
    leaseHeld: () => leaseHeld,
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
    if (app === 'admin') {
      const recoveryPath = '/api/private-workspace/recovery/settings/seal';
      const closed = await fetch(origin + recoveryPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'x-preview-instance': id(900) },
        body: JSON.stringify({
          scope: { instanceId: id(900), tenantId: tenant, actorId: actor },
          command: { private: 'PRIVATE_PRODUCTION_RECOVERY_CANARY' },
        }),
      });
      assert.equal(closed.status, 503);
      assert.match(closed.headers.get('cache-control'), /no-store/);
      assert.doesNotMatch(await closed.text(), /PRIVATE_PRODUCTION_RECOVERY_CANARY/);
      assert.equal((await fetch(origin + recoveryPath)).status, 405);
      assert.equal(
        (await fetch(origin + '/api/private-workspace/recovery/unknown/seal', { method: 'POST' }))
          .status,
        404,
      );
      evidence.productionRecoveryRouteCasesPassed = 3; // HTTP route checks, not additional browser workflow cases.
    }

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
      const shownMedia = {
        expiresAt: Date.now() + 120000,
        logouts: [],
        hold: false,
        liveMedia: true,
      };
      const loaded = await tab(reviewOrigin, path, 'review', shownMedia);
      await until(
        () =>
          loaded.evaljs(
            `(()=>{const a=[...document.querySelectorAll('.review-image-grid img')];return a.length===4&&a.every(x=>x.complete&&x.naturalWidth===2);})()`,
          ),
        'four decoded private WebP fixtures',
      );
      const urls = await loaded.evaljs(
        `(()=>{window.revokedPrivateUrls=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=u=>{window.revokedPrivateUrls.push(u);revoke(u)};return [...document.querySelectorAll('.review-image-grid img')].map(x=>x.src)})()`,
      );
      await loaded.evaljs(
        `(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signed-out'});c.close()})()`,
      );
      await until(
        async () => !(await loaded.visible()),
        'shared boundary removes decoded private media',
      );
      await until(
        async () => (await loaded.evaljs('window.revokedPrivateUrls')).length === 4,
        'all owned private blob URLs revoked',
      );
      assert.deepEqual((await loaded.evaljs('window.revokedPrivateUrls')).sort(), urls.sort());
      assert.equal(
        await loaded.evaljs(`document.querySelectorAll('.review-image-grid img').length`),
        0,
      );
      assert.deepEqual(loaded.errors, []);
      await loaded.close();
      evidence.tests.push(
        'admin/private boundary: account change unmounts private media and revokes all four decoded WebP blob URLs',
      );
      const waitingMedia = {
        expiresAt: Date.now() + 120000,
        logouts: [],
        hold: false,
        liveMedia: true,
        holdImages: true,
        imageWaiters: [],
      };
      const waiting = await tab(reviewOrigin, path, 'review', waitingMedia);
      await until(
        () => waitingMedia.imageWaiters.length === 2,
        'two concurrent private image reads held',
      );
      await waiting.evaljs(
        `(()=>{window.latePrivateUrls=0;const create=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{window.latePrivateUrls++;return create(b)};const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signed-out'});c.close()})()`,
      );
      await until(
        async () => !(await waiting.visible()),
        'shared boundary removes pending private image subscriptions',
      );
      for (const release of waitingMedia.imageWaiters) await release().catch(() => {});
      await pause(200);
      assert.equal(
        await waiting.evaljs('window.latePrivateUrls'),
        0,
        'late image replies cannot create private blob URLs after unmount',
      );
      assert.deepEqual(waiting.errors, []);
      await waiting.close();
      evidence.tests.push(
        'admin/private boundary: pending private image reads cancel and late replies create no blob URL',
      );
      const checking = {
        expiresAt: Date.now() + 120000,
        logouts: [],
        hold: false,
        holdLease: true,
        allowChecking: true,
      };
      const gate = await tab(reviewOrigin, path, 'review', checking);
      await until(() => gate.leaseHeld(), 'initial current-access read held');
      assert.equal(await gate.visible(), false);
      assert.equal(gate.reads(), 1, 'private data reads must not start before current access');
      assert.equal(
        await gate.evaljs(`document.querySelectorAll('.review-workspace-layout textarea').length`),
        0,
      );
      await gate.leaseHeld()();
      await until(gate.visible, 'initial server lease permits the current view');
      await gate.close();
      evidence.tests.push(
        'admin/private lease: initial private children and data requests wait for fresh scoped server access',
      );
      const idle = {
        expiresAt: Date.now() + 120000,
        logouts: [],
        hold: false,
        leaseExpiresAt: Date.now() + 5000,
      };
      const expiry = await tab(reviewOrigin, path, 'review', idle);
      await until(async () => !(await expiry.visible()), 'private view idle expiry', 10000);
      const expiryReads = expiry.reads();
      await expiry.evaljs(
        `window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))`,
      );
      await pause(200);
      assert.equal(expiry.reads(), expiryReads);
      assert.deepEqual(expiry.errors, []);
      await expiry.close();
      evidence.tests.push(
        'admin/private lease: verified deadline closes an idle private view and foreground events cannot reopen it',
      );
      const forbidden = { expiresAt: Date.now() + 120000, logouts: [], hold: false };
      const deniedLease = await tab(reviewOrigin, path, 'review', forbidden);
      forbidden.leaseStatus = 403;
      await deniedLease.evaljs(`window.dispatchEvent(new Event('focus'))`);
      await until(async () => !(await deniedLease.visible()), 'current lease denied');
      const deniedCount = deniedLease.reads();
      forbidden.leaseStatus = undefined;
      await deniedLease.evaljs(`window.dispatchEvent(new Event('focus'))`);
      await pause(150);
      assert.equal(deniedLease.reads(), deniedCount);
      await deniedLease.close();
      evidence.tests.push(
        'admin/private lease: fresh access denial closes the view without automatic reauthorization',
      );
      const changed = { expiresAt: Date.now() + 120000, logouts: [], hold: false };
      const roleChange = await tab(reviewOrigin, path, 'review', changed);
      changed.leaseRole = 'agent';
      await roleChange.evaljs(`window.dispatchEvent(new Event('focus'))`);
      await until(async () => !(await roleChange.visible()), 'current role changed');
      await roleChange.close();
      evidence.tests.push(
        'admin/private lease: changed current role cannot retain the prior moderation view',
      );
      const delayed = {
        expiresAt: Date.now() + 120000,
        logouts: [],
        hold: false,
        leaseExpiresAt: Date.now() + 3500,
      };
      const lateLease = await tab(reviewOrigin, path, 'review', delayed);
      delayed.holdLease = true;
      await lateLease.evaljs(`window.dispatchEvent(new Event('focus'))`);
      await until(() => lateLease.leaseHeld(), 'renewal held before deadline');
      await until(
        async () => !(await lateLease.visible()),
        'held lease cannot outlive private deadline',
        10000,
      );
      await lateLease
        .leaseHeld()()
        .catch(() => {});
      await pause(200);
      assert.equal(await lateLease.visible(), false);
      await lateLease.close();
      evidence.tests.push(
        'admin/private lease: late renewal response cannot extend or reopen an expired view',
      );
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
  const referenceOrigin = await start('admin', 'references');
  for (const kind of ['creation', 'successor']) {
    const fixture = kind === 'creation' ? creationFixture : successorFixture;
    const original = structuredClone(fixture.command(200));
    original.content.title = 'PRIVATE_ORIGINAL_CANARY';
    original.content.privateAddress = 'PRIVATE_ORIGINAL_ADDRESS_CANARY';
    const map = new Map(),
      store = {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => map.set(k, v),
        removeItem: (k) => map.delete(k),
      };
    const identity = { instanceId: id(900), tenantId: tenant, actorId: actor };
    if (kind === 'creation')
      openReferenceCreationEntry(store, identity, () => listing).session.retain(
        original,
        fixture.catalogue(),
      );
    else
      referenceSuccessorSession(store, { ...identity, listingId: listing }).retain(
        original,
        fixture.catalogue(),
      );
    const seed = () => ({
      referenceKind: kind,
      originalEntries: [...map],
      expiresAt: Date.now() + 120000,
      logouts: [],
      hold: false,
    });
    const route = kind === 'creation' ? '/listings/new' : '/listings/' + listing + '/successor';
    const snapshot = (t) => t.evaljs('JSON.stringify(Object.entries(sessionStorage).sort())');
    const closeCheck = async (t, before) => {
      await until(async () => !(await t.visible()), kind + ' private view cleared');
      assert.equal(await snapshot(t), before, 'uncertain original must remain byte-for-byte');
      assert.equal(await t.evaljs("document.querySelectorAll('input,textarea,select').length"), 0);
      assert.doesNotMatch(await t.evaljs('document.body.innerText'), /PRIVATE_ORIGINAL/);
    };
    const m = seed(),
      t = await tab(referenceOrigin, route, kind, m),
      before = await snapshot(t);
    m.holdReference = true;
    await t.click('Recover original');
    await until(() => t.held(), kind + ' recovery held');
    await t.evaljs(
      "(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signing-out'});c.close()})()",
    );
    await closeCheck(t, before);
    await t
      .held()()
      .catch(() => {});
    await pause(150);
    await closeCheck(t, before);
    const count = t.reads();
    await t.evaljs(
      "window.dispatchEvent(new Event('focus'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))",
    );
    await pause(100);
    assert.equal(t.reads(), count);
    assert.deepEqual(t.errors, []);
    await t.close();
    evidence.tests.push(
      'admin/' +
        kind +
        ': logout removes private form/original, cancels held recovery and refuses its late success while retaining exact original storage',
    );
    for (const status of [401, 403]) {
      const denied = seed(),
        d = await tab(referenceOrigin, route, kind, denied),
        saved = await snapshot(d);
      denied.referenceStatus = status;
      await d.click('Recover original');
      await closeCheck(d, saved);
      assert.deepEqual(d.errors, []);
      await d.close();
      evidence.tests.push(
        'admin/' +
          kind +
          ': raw HTTP ' +
          status +
          ' closes private rendering and preserves the uncertain original',
      );
    }
    const idle = seed();
    idle.leaseExpiresAt = Date.now() + 5000;
    const exp = await tab(referenceOrigin, route, kind, idle),
      saved = await snapshot(exp);
    await closeCheck(exp, saved);
    const n = exp.reads();
    await exp.evaljs("window.dispatchEvent(new Event('focus'))");
    await pause(100);
    assert.equal(exp.reads(), n);
    assert.deepEqual(exp.errors, []);
    await exp.close();
    evidence.tests.push(
      'admin/' +
        kind +
        ': idle credential deadline removes private forms/original and foreground does not reopen them',
    );
  }
  const ordinaryOrigin = await start('admin', 'ordinary');
  for (const kind of ['allocation-creation', 'allocation-successor', 'directory']) {
    const identity = { instanceId: id(900), tenantId: tenant, actorId: actor },
      map = new Map(),
      store = {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => map.set(k, v),
        removeItem: (k) => map.delete(k),
      };
    let command;
    if (kind === 'directory') {
      command = {
        policy: 'staff-branch-command-v1',
        operationId: id(1000),
        branchId: id(201),
        expectedVersion: '0',
        name: 'PRIVATE_STAFF_ORIGINAL_CANARY',
        active: true,
        reason: 'Synthetic original',
      };
      map.set(
        'realtor.staff-write.v1:' + identity.instanceId + ':' + tenant + ':' + actor,
        serializeStaffWrite(
          markStaffWriteUncertain(prepareStaffWrite(identity, 'branch', command), identity),
        ),
      );
    } else {
      const { policy, selection, ...raw } = structuredClone(
        (kind === 'allocation-creation' ? creationFixture : successorFixture).command(200),
      );
      command = raw;
      command.content.title = 'PRIVATE_STAFF_ORIGINAL_CANARY';
      if (kind === 'allocation-creation')
        creationAllocationSession(store, identity).retain(command);
      else successorAllocationSession(store, identity, listing).retain(command);
    }
    const seed = () => ({
      ordinaryKind: kind,
      ordinaryCommand: command,
      originalEntries: [...map],
      expiresAt: Date.now() + 120000,
      logouts: [],
      hold: false,
    });
    const path =
      kind === 'directory'
        ? '/staff'
        : kind === 'allocation-creation'
          ? '/listings/new'
          : '/listings/' + listing + '/successor';
    const label =
      kind === 'directory' ? 'Recover original by GET' : 'Recover exact original with GET';
    const snapshot = (t) => t.evaljs('JSON.stringify(Object.entries(sessionStorage).sort())');
    const cleared = async (t, saved) => {
      await until(async () => !(await t.visible()), kind + ' cleared');
      assert.equal(await snapshot(t), saved);
      assert.equal(await t.evaljs("document.querySelectorAll('input,textarea,select').length"), 0);
      assert.doesNotMatch(
        await t.evaljs('document.body.innerText'),
        /PRIVATE_STAFF_ORIGINAL_CANARY/,
      );
    };
    const model = seed(),
      tabbed = await tab(ordinaryOrigin, path, kind, model),
      before = await snapshot(tabbed);
    model.holdOrdinary = true;
    await tabbed.click(label);
    await until(() => tabbed.held(), kind + ' held recovery');
    await tabbed.evaljs(
      "(()=>{const c=new BroadcastChannel('realtor-hosted-auth-v1');c.postMessage({type:'auth-changed',reason:'signing-out'});c.close()})()",
    );
    await cleared(tabbed, before);
    await tabbed
      .held()()
      .catch(() => {});
    await pause(150);
    await cleared(tabbed, before);
    const count = tabbed.reads();
    await tabbed.evaljs("window.dispatchEvent(new Event('focus'))");
    await pause(100);
    assert.equal(tabbed.reads(), count);
    assert.deepEqual(tabbed.errors, []);
    await tabbed.close();
    evidence.tests.push(
      'admin/' +
        kind +
        ': logout clears private fields/original, cancels held recovery and suppresses late success without changing retained bytes',
    );
    for (const status of [401, 403]) {
      const denied = seed(),
        t = await tab(ordinaryOrigin, path, kind, denied),
        saved = await snapshot(t);
      denied.ordinaryStatus = status;
      await t.click(label);
      await cleared(t, saved);
      assert.deepEqual(t.errors, []);
      await t.close();
      evidence.tests.push(
        'admin/' +
          kind +
          ': raw HTTP ' +
          status +
          ' closes private rendering while preserving uncertain original',
      );
    }
    const idle = seed();
    idle.leaseExpiresAt = Date.now() + 5000;
    const t = await tab(ordinaryOrigin, path, kind, idle),
      saved = await snapshot(t);
    await cleared(t, saved);
    const n = t.reads();
    await t.evaljs("window.dispatchEvent(new Event('focus'))");
    await pause(100);
    assert.equal(t.reads(), n);
    assert.deepEqual(t.errors, []);
    await t.close();
    evidence.tests.push(
      'admin/' +
        kind +
        ': verified idle expiry closes private rendering and focus cannot reopen it',
    );
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
  if (referenceServer) {
    referenceServer.closeAllConnections();
    await new Promise((r) => referenceServer.close(r));
  }
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.rej(Error('Browser closed'));
  }
  pending.clear();
}
