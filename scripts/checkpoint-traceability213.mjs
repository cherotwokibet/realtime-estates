/** One-shot traceability acceptance; no product case or release gate is closed. */
import { readFile, writeFile, copyFile, mkdir, cp } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const source = new URL('../', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
assert.equal(plan.baselineRevision, 'operations-overview-2026-10-28-212');
const tasks = plan.stages.flatMap((stage) => stage.tasks);
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((task) => task.done).length, 36);
assert.equal(
  plan.stages.reduce((count, stage) => count + stage.notes.length, 0),
  683,
);
const ledger = JSON.parse(await readFile(new URL('docs/acceptance-status.json', source), 'utf8'));
assert.equal(ledger.cases.length, 35);
assert.equal(ledger.originalReport.substantiveFindings, 24);
assert.equal(ledger.cases.filter((item) => item.releaseCasePassed).length, 0);
const task = tasks.find((item) => item.id === '12-1');
assert.equal(task.done, false);
const summary =
  'Checkpoint213 (28 October2026): completed maintained requirement/case/evidence/defect/retest traceability (12-1). All24 substantive original findings and35 replacement cases have scoped evidence or explicit gaps/next actions, with4 bounded defect retests and an unchanged byte-hashed original snapshot. Search/filter/details/empty states and narrow keyboard layout checked in the browser; reproducible ledger check passed. Media194/194 passed. This is traceability maintenance, not closure of the product cases, incomplete upload cleanup, devices or release gates.37/97tasks(38%rounded),0/14gates;12more whole tasks needed to cross50%.';
const evidence = 'realtor-platform/docs/evidence/2026-10-28-acceptance-traceability.md';
task.done = true;
task.evidence += `\n\nAccepted checkpoint213,28October2026:${summary} Evidence:${evidence}; canonical docs/acceptance-status.json/.md/.html and scripts/acceptance-status.mjs. Source ancestry,24+reserved/35coverage, report hashes/counts and failure/retest links checked. No legacy PASS or suite total is promoted into a complete product-case pass.`;
for (const id of ['06', '12'])
  plan.stages
    .find((stage) => stage.id === id)
    .notes.push({
      date: '28 October2026',
      author: 'Codex',
      text: `${summary} Evidence:${evidence}. Next: implement missing viewing calendar/notification failure presentation and scoped media lifecycle; preserve uncertain/referenced outputs. Owner:Boniface+Codex.`,
    });
for (const id of ['06-3', '06-7']) {
  const open = tasks.find((task) => task.id === id);
  assert.equal(open.done, false);
  open.evidence += `\n\nCheckpoint213 media194/194passed; broader acceptance remains open: incomplete/expired batch cleanup, image-backed0/3/4/12/13 browser matrix and interrupted file3/4 recovery. See ${evidence} and GAP-AC-005/018/019/030 in the maintained index.`;
}
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'acceptance-traceability-2026-10-28-213';
plan.baseline = summary;
await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n');
await writeFile(
  new URL('dist/plan-data.js', dashboard),
  `window.REALTOR_PLAN=${JSON.stringify(plan)};\n`,
);
const planDoc = new URL('DELIVERY-PLAN.md', dashboard);
await writeFile(
  planDoc,
  (await readFile(planDoc, 'utf8')).replace(
    '# Realtor Platform Rebuild — Delivery Plan',
    `# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint — 28 October2026 (213)\n\n${summary} Evidence:${evidence}.`,
  ),
);
await copyFile(planDoc, new URL('dist/DELIVERY-PLAN.md', dashboard));
for (const name of ['acceptance-status.html', 'acceptance-status.json', 'acceptance-status.md'])
  await copyFile(new URL('docs/' + name, source), new URL('dist/' + name, dashboard));
for (const record of Object.values(ledger.executions)) {
  const target = new URL('dist/' + record.path.replace(/^docs\//, ''), dashboard);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(record.path, source), target);
}
for (const fix of ledger.fixes)
  if (fix.before) {
    const target = new URL('dist/' + fix.before.replace(/^docs\//, ''), dashboard);
    await mkdir(new URL('./', target), { recursive: true });
    await copyFile(new URL(fix.before, source), target);
  }
await copyFile(
  new URL('docs/evidence/2026-10-28-acceptance-traceability.md', source),
  new URL('dist/evidence/2026-10-28-acceptance-traceability.md', dashboard),
);
await cp(
  new URL('docs/evidence/2026-10-28-upload-acceptance/', source),
  new URL('dist/evidence/2026-10-28-upload-acceptance/', dashboard),
  { recursive: true },
);
const htmlPath = new URL('dist/index.html', dashboard);
const html = await readFile(htmlPath, 'utf8');
assert.match(html, /<section class="checkpoint"/);
await writeFile(
  htmlPath,
  html.replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">28 OCTOBER · EVIDENCE AND NEXT ACTIONS</span><h2>Every original finding has a clear next step.</h2><p>The searchable acceptance index links24 original findings to35 replacement cases, executed evidence and open gaps. Four corrected defects retain their bounded retests. Product cases and launch gates remain open where evidence is missing.</p><p>37 of97 tasks complete ·38% rounded. Your50% target needs12 more whole tasks. Incomplete upload cleanup and actual-device/operator verification remain open.</p><a href="acceptance-status.html">Explore cases, evidence and next actions →</a><br><a href="evidence/2026-10-28-acceptance-traceability.md">Read checkpoint evidence →</a></div><div class="checkpoint-metrics"><strong>24 findings ·35 cases</strong><span>10 scoped execution records, no legacy passes imported</span><strong>194 media checks rerun</strong><span>Valid/corrupt bytes, cancellation and duplicate guards</span><strong>0 of14 release gates</strong><span>Traceability does not close product defects automatically</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL('docs/' + name, source);
  await writeFile(
    path,
    `## Latest checkpoint213 —28October2026\n\n${summary} Evidence:[maintained traceability](evidence/2026-10-28-acceptance-traceability.md). Current operations feature86cf7ed and owner-private dashboard version199/source2af08fa succeeded, one owner/zero external visitors/groups. Same-device complete source bundle/fresh clean restore/fsck passed. Original UAT report snapshot preserved byte-for-byte; source/index checks do not require its external original path. Exact next: commit/back up213, publish same private dashboard with notes preserved, then implement a bounded company/role-protected viewing calendar with current authorized action links and honest notification state; media cleanup and full device/operator/provider/rights/cutover gates remain open. No GitHub push/Actions rerun or paid service/reset. Owner:Boniface+Codex.\n\n${await readFile(path, 'utf8')}`,
  );
}
console.log(
  JSON.stringify({ done: 37, total: 97, notes: 685, acceptedGates: 0, completeReleaseCases: 0 }),
);
