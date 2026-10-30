/** One-shot223: verified local tasks only; preserve every previous task, gate and note. */
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url),
  dash = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const planPath = new URL('dist/plan.json', dash),
  plan = JSON.parse(await readFile(planPath, 'utf8'));
const before = structuredClone(plan),
  tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'public-keyboard-performance-2026-10-29-222');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 47);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  703,
);
const prefix = 'docs/evidence/2026-10-30-listing-reports/';
for (const [name, counts] of [
  ['sdk-full-final.txt', [307]],
  ['web-full-final.txt', [114]],
  ['admin-full-final.txt', [448, 34]],
  ['signed-http-lost-results.txt', [3]],
  ['admin-boundaries-final.txt', [3]],
  ['authorization-inventory.txt', [1]],
  ['sql-inventory-corrected.txt', [1]],
  ['authorization-api.txt', [20]],
  ['authorization-role-tenants.txt', [26]],
  ['authorization-storage.txt', [47]],
]) {
  const text = await read(prefix + name);
  assert.deepEqual(
    [...text.matchAll(/(?:ℹ|#) pass (\d+)/g)].map((m) => Number(m[1])),
    counts,
    name,
  );
  assert.ok(!/(?:ℹ|#) (?:fail|cancelled|skipped) [1-9]/.test(text), name);
}
const sql = await read(prefix + 'sql-full-final.txt');
assert.match(sql, /tests 364/);
assert.match(sql, /pass 363/);
assert.match(sql, /fail 1/);
assert.match(sql, /listing_report_decisions/);
for (const name of ['web-build-final.txt', 'admin-build-final.txt']) {
  const text = await read(prefix + name);
  assert.match(text, /Finished TypeScript/);
  assert.match(text, /Finalizing page optimization/);
  assert.match(text, /Route \(app\)/);
}
assert.match(
  await read(prefix + 'browser/public-fixed-recovered.dom.txt'),
  /Report saved for company review/,
);
assert.match(await read(prefix + 'browser/admin-recovered.dom.txt'), /Review saved at version2/);
const preservation = JSON.parse(await read(prefix + 'browser-notes-preservation.json'));
const exported = await readFile(preservation.exportPath);
assert.equal(createHash('sha256').update(exported).digest('hex'), preservation.sha256);
const browser = JSON.parse(exported);
assert.equal(
  browser.stages.reduce((n, s) => n + s.notes.length, 0),
  709,
);
for (const s of browser.stages) {
  const canonical = plan.stages.find((c) => c.id === s.id);
  for (const n of s.notes)
    if (!canonical.notes.some((x) => JSON.stringify(x) === JSON.stringify(n)))
      canonical.notes.push(n);
}
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  709,
);
const summary =
  'Checkpoint223 (30October2026): completed locally verified guest call/WhatsApp/enquiry/report actions07-4 and API/storage authorization review12-2. Actual report capture/admin review/publication independence/narrow browser and both committed-reply original recoveries passed. Full SDK307/web114/admin448+34, signed report3, role/tenant26, JWT/HTTP20, storage47 and permission inventories passed; complete web/admin production builds passed. SQL full run363/364 had one stale expected-table inventory failure, corrected/retested1/1; failed log retained, no runtime SQL change.49/97tasks(51%rounded),0/14gates. Six browser Tracker notes merged without changing browser checkbox/status edits. No Actions/app push/purchases/credits/plan/credential/vendor/live change; production/provider/device/operator/rights/cutover acceptance remains open.';
for (const [id, path] of [
  ['07-4', 'docs/evidence/2026-10-30-listing-reports.md'],
  ['12-2', 'docs/evidence/2026-10-30-authorization-review.md'],
]) {
  const task = tasks.find((t) => t.id === id);
  assert.equal(task.done, false);
  task.done = true;
  task.evidence +=
    '\n\nAccepted223 local implementation/review scope. ' +
    summary +
    ' Evidence:realtor-platform/' +
    path +
    '; proof6b8569b. No complete AC case or launch gate inferred.';
}
for (const id of ['07', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '30October2026',
      author: 'Codex',
      text:
        summary +
        ' Evidence:realtor-platform/docs/evidence/2026-10-30-listing-reports.md and2026-10-30-authorization-review.md. Next preserve source/fresh restore and publish same owner-private dashboard; then continue remaining normalized catalogue, staff/session/native and external scopes. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'listing-reports-authorization-2026-10-30-223';
plan.baseline = summary;
assert.equal(tasks.filter((t) => t.done).length, 49);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  711,
);
for (const s of plan.stages) {
  const old = before.stages.find((x) => x.id === s.id);
  assert.equal(s.status, old.status);
  assert.deepEqual(s.notes.slice(0, old.notes.length), old.notes);
  for (const t of s.tasks) {
    const oldTask = old.tasks.find((x) => x.id === t.id);
    if (!['07-4', '12-2'].includes(t.id)) assert.deepEqual(t, oldTask);
  }
}
await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n');
await writeFile(
  new URL('dist/plan-data.js', dash),
  'window.REALTOR_PLAN=' + JSON.stringify(plan) + ';\n',
);
const doc = new URL('DELIVERY-PLAN.md', dash);
await writeFile(
  doc,
  (await readFile(doc, 'utf8')).replace(
    '# Realtor Platform Rebuild — Delivery Plan',
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —30October2026 (223)\n\n' +
      summary +
      ' Evidence:realtor-platform/docs/evidence/2026-10-30-listing-reports.md and2026-10-30-authorization-review.md.',
  ),
);
await copyFile(doc, new URL('dist/DELIVERY-PLAN.md', dash));
for (const f of ['acceptance-status.html', 'acceptance-status.md', 'acceptance-status.json'])
  await copyFile(new URL('docs/' + f, root), new URL('dist/' + f, dash));
const ledger = JSON.parse(await read('docs/acceptance-status.json'));
assert.equal(Object.keys(ledger.executions).length, 59);
for (const r of Object.values(ledger.executions)) {
  const out = new URL('dist/' + r.path.replace(/^docs\//, ''), dash);
  await mkdir(new URL('./', out), { recursive: true });
  await copyFile(new URL(r.path, root), out);
}
await cp(new URL(prefix, root), new URL('dist/evidence/2026-10-30-listing-reports/', dash), {
  recursive: true,
});
const html = new URL('dist/index.html', dash);
let text = await readFile(html, 'utf8');
const pattern = /<section[^>]*aria-label="Latest verified checkpoint"[\s\S]*?<\/section>/;
assert.equal((text.match(new RegExp(pattern.source, 'g')) ?? []).length, 1);
text = text.replace(
  pattern,
  '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">30 OCTOBER · HALF THE DELIVERY CHECKLIST VERIFIED</span><h2>49 tasks complete. Evidence kept. Release gates open.</h2><p>Guest concerns now reach a company review queue. Both public and admin recover saved originals after a lost reply. API and owned-storage permission review is complete in the local synthetic environment.</p><p>49 of97 tasks complete ·51% rounded. Web and admin production builds passed. The SQL inventory failure and its corrected retest remain visible. All14 release gates remain open.</p><a href="evidence/2026-10-30-listing-reports.md">Review report workflow and verification →</a><br><a href="evidence/2026-10-30-authorization-review.md">Review API and storage authorization →</a><br><a href="ci-efficiency.md">Review local CI conservation before November1 →</a></div><div class="checkpoint-metrics"><strong>49 /97 tasks</strong><span>Whole local deliverables, not launch acceptance</span><strong>Original results recovered</strong><span>Public capture and admin review tested in browser</span><strong>0 of14 release gates</strong><span>Production, provider, device and operator work remain</span></div></section>',
);
await writeFile(html, text);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const p = new URL('docs/' + name, root);
  let old = await readFile(p, 'utf8');
  if (old.startsWith('## In progress223')) old = old.slice(old.indexOf('## Latest checkpoint222'));
  await writeFile(
    p,
    '## Latest checkpoint223 —30October2026\n\n' +
      summary +
      ' Source backup/private publication still pending. Ledger59executions/6fixed defects/35incomplete cases. Next: complete source bundle/fresh clean restore/fsck and same owner-private publication preserving notes; independently audit49/97 before completing the50% goal. No preview or test process active.\n\n' +
      old,
  );
}
await writeFile(
  new URL('docs/ACTIVE-WORK.md', root),
  '# Active work —223 local tasks reach49/97; preservation/publication pending\n\n' +
    summary +
    '\n\nLedger59executions,6fixed defects,35incomplete cases,0gates. Exact next: complete same-device source bundle/fresh clean restore/fsck, publish and independently audit existing owner-private dashboard. Do not replay checkpoint220/221/222/223 scripts. No active owned preview/test. Continue remaining full rebuild after50%goal.\n',
);
await writeFile(
  new URL(prefix + 'checkpoint-verification.json', root),
  JSON.stringify(
    {
      checkpoint: 223,
      tasks: 49,
      total: 97,
      roundedPercent: 51,
      notes: 711,
      mergedBrowserNotes: 6,
      gatesChanged: false,
      priorNotesPreserved: true,
      otherTasksPreserved: true,
      executions: 59,
      sourceProof: '6b8569b',
      publication: 'pending',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ done: 49, total: 97, percent: 51, notes: 711, gates: 0, executions: 59 }),
);
