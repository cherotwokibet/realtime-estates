/** One-shot222. Refuse a changed canonical baseline; do not replay after later work. */
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url),
  dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const read = async (p) => readFile(new URL(p, root), 'utf8');
const api = JSON.parse(await read('docs/evidence/2026-10-29-performance/api-final.json'));
const web = JSON.parse(await read('docs/evidence/2026-10-29-performance/web-complete.json'));
const failed = JSON.parse(await read('docs/evidence/2026-10-29-performance/web-initial.json'));
const hash = createHash('sha256')
  .update(await readFile(new URL('scripts/performance-budget.json', root)))
  .digest('hex');
for (const r of [api, web]) {
  assert.equal(r.status, 'passed');
  assert.equal(r.complete, true);
  assert.equal(r.budgetSha256, hash);
  assert.equal(r.violations.length, 0);
  assert.equal(r.cleanup, 'Owned servers/database closed');
}
assert.equal(failed.status, 'failed');
assert.equal(failed.complete, false);
assert.equal(api.samples.length, 48);
assert.equal(api.probes.length, 12);
assert.deepEqual(
  api.seed.observed.map((r) => [r.tenantSlug, r.listings, r.photoRefs]),
  [
    ['realtime-estates', 500, 2000],
    ['sample-homes', 500, 2000],
  ],
);
assert.equal(web.routes.length, 5);
for (const r of web.routes) {
  assert.equal(r.summary.requests, 5);
  assert.ok(r.p95TtfbMs <= 1000);
  assert.ok(r.initialJsGzipBytes <= 512000);
  assert.ok(r.summary.maxBodyBytes <= 524288);
}
const focus = JSON.parse(await read('docs/evidence/2026-10-29-public-keyboard/focus-final.json'));
assert.equal(focus[0].id, 'main');
assert.equal(focus[2].id, 'search');
const approach = JSON.parse(
  await read('docs/evidence/2026-10-29-public-keyboard/approach-final.json'),
);
assert.equal(approach.id, 'how');
assert.equal(approach.tag, 'SECTION');
const routes = JSON.parse(
  await read('docs/evidence/2026-10-29-public-keyboard/route-layout-320.json'),
);
assert.equal(routes.length, 5);
assert.ok(routes.every((r) => r.focus === 'main' && r.doc <= r.width && r.width === 320));
const tabs = JSON.parse(
  await read('docs/evidence/2026-10-29-public-keyboard/search-tab-sequence-320.json'),
);
assert.equal(tabs.length, 13);
assert.ok(tabs.every((r) => r.left >= 0 && r.right <= r.viewport && r.outline === 'solid 2.4px'));
const desktop = JSON.parse(
  await read('docs/evidence/2026-10-29-public-keyboard/desktop-1280.json'),
);
assert.equal(desktop.width, 1280);
assert.ok(desktop.doc <= 1280);
assert.match(desktop.heading, /Find a place/);
assert.match(
  await read('docs/evidence/2026-10-29-public-keyboard/web-tests-complete.txt'),
  /pass 109/,
);
const ledger = JSON.parse(await read('docs/acceptance-status.json'));
assert.equal(Object.keys(ledger.executions).length, 41);
const target = new URL('dist/plan.json', dashboard),
  plan = JSON.parse(await readFile(target, 'utf8')),
  tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'original-preservation-2026-10-29-221');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 45);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  701,
);
const summary =
  'Checkpoint222 (29October2026): completed public browser keyboard/reflow/loading verification07-7 and representative local performance measurement12-5. Explicit main/search/native approach focus corrected;320/390/1280 browser layouts,13-control Tab sequence, keyboard filters/navigation/gallery and109 web checks/final production build verified. Two companies each500 approved listings/2000 metadata photo refs;48 actual HTTP reads at4 clients, p95=536.007ms. Final warm web headers p95<=44.437ms/initial JS<=228839gzip bytes; original cold timeout retained.47/97tasks(48%rounded),0/14gates;2more whole tasks needed to cross50%. Field/device/assistive/hosted/private-load and all release gates stay open. App/CI development remains local before1November; no Actions/purchases/credits/plan/credential/vendor/live change.';
for (const [id, evidence] of [
  ['07-7', 'docs/evidence/2026-10-29-public-keyboard.md'],
  ['12-5', 'docs/evidence/2026-10-29-performance.md'],
]) {
  const task = tasks.find((t) => t.id === id);
  assert.equal(task.done, false);
  task.done = true;
  task.evidence +=
    '\n\nAccepted222 local implementation/measurement scope. ' +
    summary +
    ' Evidence:realtor-platform/' +
    evidence +
    '; feature1c01df2 and proofaa414973efd01198e865a0cb29ec6c7edc96f7f3. No actual phone/assistive-tech/field/provider/operator/cutover acceptance inferred.';
}
for (const id of ['07', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '29October2026',
      author: 'Codex',
      text:
        summary +
        ' Evidence:realtor-platform/docs/evidence/2026-10-29-public-keyboard.md and2026-10-29-performance.md. Original failed cold result preserved, no relaxed budget. Next: preserve/publish222 retaining browser notes, implement actual fake-listing reporting and continue native/admin work toward49/97. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'public-keyboard-performance-2026-10-29-222';
plan.baseline = summary;
await writeFile(target, JSON.stringify(plan, null, 2) + '\n');
await writeFile(
  new URL('dist/plan-data.js', dashboard),
  'window.REALTOR_PLAN=' + JSON.stringify(plan) + ';\n',
);
const doc = new URL('DELIVERY-PLAN.md', dashboard);
await writeFile(
  doc,
  (await readFile(doc, 'utf8')).replace(
    '# Realtor Platform Rebuild — Delivery Plan',
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —29October2026 (222)\n\n' +
      summary +
      ' Evidence:realtor-platform/docs/evidence/2026-10-29-public-keyboard.md and2026-10-29-performance.md.',
  ),
);
await copyFile(doc, new URL('dist/DELIVERY-PLAN.md', dashboard));
for (const name of ['acceptance-status.html', 'acceptance-status.md', 'acceptance-status.json'])
  await copyFile(new URL('docs/' + name, root), new URL('dist/' + name, dashboard));
for (const record of Object.values(ledger.executions)) {
  const out = new URL('dist/' + record.path.replace(/^docs\//, ''), dashboard);
  await mkdir(new URL('./', out), { recursive: true });
  await copyFile(new URL(record.path, root), out);
}
for (const stem of ['2026-10-29-performance', '2026-10-29-public-keyboard']) {
  await copyFile(
    new URL('docs/evidence/' + stem + '.md', root),
    new URL('dist/evidence/' + stem + '.md', dashboard),
  );
  await cp(
    new URL('docs/evidence/' + stem + '/', root),
    new URL('dist/evidence/' + stem + '/', dashboard),
    { recursive: true },
  );
}
await copyFile(
  new URL('scripts/performance-budget.json', root),
  new URL('dist/evidence/2026-10-29-performance/performance-budget.json', dashboard),
);
await writeFile(
  new URL('dist/performance-lab.md', dashboard),
  (await read('docs/performance-lab.md')).replace(
    '../scripts/performance-budget.json',
    'evidence/2026-10-29-performance/performance-budget.json',
  ),
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">29 OCTOBER · KEYBOARD AND LOAD VERIFIED LOCALLY</span><h2>Usable focus. Measured inventory. Recorded limits.</h2><p>Public keyboard shortcuts now move focus to the right content. Narrow form/gallery/navigation checks and current web tests/build passed. The local load lab independently counted500 approved listings in each of two companies.</p><p>47 of97 tasks complete ·48% rounded. Two more whole tasks are needed to cross50%. The first cold web timeout remains recorded; actual devices, field performance and release gates remain open.</p><a href="evidence/2026-10-29-public-keyboard.md">Review keyboard and layout evidence →</a><br><a href="evidence/2026-10-29-public-keyboard/search-focus-320.jpg">View320px keyboard focus →</a><br><a href="evidence/2026-10-29-performance.md">Review measured budgets and retained failure →</a><br><a href="ci-efficiency.md">Review local CI conservation before November1 →</a></div><div class="checkpoint-metrics"><strong>1,000 approved synthetic listings</strong><span>Two isolated company projections; media metadata only</span><strong>536ms API p95</strong><span>48 finite reads/4 clients; no sustained/hosted capacity claim</span><strong>0 of14 release gates</strong><span>No device, operator or production cutover acceptance</span></div></section>',
  ),
);
const next =
  'Feature1c01df2 and proofaa41497 local; ledger41executions/6registered fixed defects/35incomplete cases,0gates. Prior221 private dashboard208/source659cecfc succeeded under1owner/0visitors/groups; source16532d8 same-device complete bundle/fresh clean restore/fsck/35execution check passed. Exact next: finish222 source backup/private status publication preserving browser notes, then implement durable anonymous fake-listing reports with current public eligibility, bounded abuse controls, exact original recovery and company/admin handling; verify actual API/SQL/browser before07-4 acceptance. Continue remaining admin/native scope toward49/97. Keep default-off reference deployment controls unpromoted until controller/attestation/drain/ownerDDL lease/reconciliation/hosted locking proof. All owned3130/API previews and current verification tabs stopped/closed; viewport overrides reset. Prior error-tab4 cleanup limitation remains historical. No app GitHub push/Actions before1November, purchases/credits/reset/plan/credential change or old-live cutover. Owner:Boniface+Codex.';
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const p = new URL('docs/' + name, root);
  await writeFile(
    p,
    '## Latest checkpoint222 —29October2026\n\n' +
      summary +
      ' Evidence:[keyboard](evidence/2026-10-29-public-keyboard.md),[performance](evidence/2026-10-29-performance.md). ' +
      next +
      '\n\n' +
      (await readFile(p, 'utf8')),
  );
}
await writeFile(
  new URL('docs/ACTIVE-WORK.md', root),
  '# Active work —222 local keyboard/performance complete; continue toward50%\n\n' +
    summary +
    '\n\n' +
    next +
    '\n\nDo not replay guarded checkpoint220/221/222 scripts. Current plan47/97,703notes,0gates. Original2254-file preservation and readonly archives remain verified; no asset/data rights inferred. Exact API/web measurements retain unchanged predeclared budget hash and source hashes. Initial cold failure is not erased. Full field/private/actualmedia/hosted/device/assistive audits remain open; do not relabel browser lab as production verification.\n',
);
console.log(JSON.stringify({ done: 47, total: 97, notes: 703, gates: 0, executions: 41 }));
