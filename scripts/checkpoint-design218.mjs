/** One-shot218: refuse a later canonical baseline; never rerun after success. */
import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const path = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(path, 'utf8'));
const tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'current-public-gallery-2026-10-29-217');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 41);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  693,
);
const summary =
  'Checkpoint218 (29 October2026): completed connected responsive public/staff design handoff03-4/03-5. All16 prototype screens observed at1280/320px with heading focus and no horizontal overflow; exact costs, enquiry/viewing design receipts, photo comparison/adoption, terminal moderation, agreement/outcomes, invite expiry and second-brand preview checked. Design-only: planned staff/settings/reports backend and operator03-7 remain open.43/97tasks(44%rounded),0/14gates;6more whole tasks needed to cross50%.';
const evidence = 'realtor-platform/docs/evidence/2026-10-29-connected-design.md';
for (const id of ['03-4', '03-5']) {
  const task = tasks.find((t) => t.id === id);
  assert.equal(task.done, false);
  task.done = true;
  task.evidence +=
    '\n\nAccepted218 as completed design/handoff only. ' +
    summary +
    ' Feature8d3fa7fa9de2d3073ea20016bf474dab0b6225c7; ' +
    evidence +
    '. Interactive design:design/connected-journeys.html. No planned backend feature, operator review, product acceptance case or launch gate closed.';
}
for (const id of ['03', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '29 October2026',
      author: 'Codex',
      text:
        summary +
        ' Evidence:' +
        evidence +
        '. Source syntax/format passed; detailed DOM/screenshot proof retained. Owned3119 preview/tab14 closed; original browser notes unchanged. Next: approved company settings with current company/admin authorization, history and connected preview; remaining catalogue/staff/native scope. App source stays local; no Actions, purchases, credits/reset/plan changes. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'connected-design-2026-10-29-218';
plan.baseline = summary;
await writeFile(path, JSON.stringify(plan, null, 2) + '\n');
await writeFile(
  new URL('dist/plan-data.js', dashboard),
  'window.REALTOR_PLAN=' + JSON.stringify(plan) + ';\n',
);
const planDoc = new URL('DELIVERY-PLAN.md', dashboard);
await writeFile(
  planDoc,
  (await readFile(planDoc, 'utf8')).replace(
    '# Realtor Platform Rebuild — Delivery Plan',
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —29October2026 (218)\n\n' +
      summary +
      ' Evidence:' +
      evidence +
      '.',
  ),
);
await copyFile(planDoc, new URL('dist/DELIVERY-PLAN.md', dashboard));
for (const name of ['acceptance-status.html', 'acceptance-status.md', 'acceptance-status.json'])
  await copyFile(new URL('docs/' + name, root), new URL('dist/' + name, dashboard));
const ledger = JSON.parse(await readFile(new URL('docs/acceptance-status.json', root), 'utf8'));
for (const record of Object.values(ledger.executions)) {
  const target = new URL('dist/' + record.path.replace(/^docs\//, ''), dashboard);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(record.path, root), target);
}
await cp(new URL('docs/design/', root), new URL('dist/design/', dashboard), { recursive: true });
await cp(
  new URL('docs/evidence/2026-10-29-connected-design/', root),
  new URL('dist/evidence/2026-10-29-connected-design/', dashboard),
  { recursive: true },
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">29 OCTOBER · CONNECTED DESIGN HANDOFF</span><h2>Explore the public and staff journeys.</h2><p>Sixteen connected screens cover search, exact costs, enquiries, viewing agreement, drafts, photo recovery, moderation, staff roles and reporting. Planned backend features are clearly labelled.</p><p>43 of97 tasks complete ·44% rounded. Six more whole tasks are needed to cross50%. Operator review, actual devices and release gates remain open.</p><a href="design/connected-journeys.html">Open the interactive design →</a><br><a href="design/connected-journeys.md">Read implementation handoff →</a><br><a href="evidence/2026-10-29-connected-design.md">Read observations and limits →</a></div><div class="checkpoint-metrics"><strong>16 connected design screens</strong><span>Desktop and320px navigation/focus/overflow checked</span><strong>Public and staff recovery</strong><span>In-memory prototype; no messages, tokens or backend writes</span><strong>0 of14 release gates</strong><span>Planned backend features and operator review remain open</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const target = new URL('docs/' + name, root);
  await writeFile(
    target,
    '## Latest checkpoint218 —29October2026\n\n' +
      summary +
      ' Evidence:[connected design](evidence/2026-10-29-connected-design.md), [interactive prototype](design/connected-journeys.html). Feature8d3fa7f stays local. Maintained ledger25executions/6fixed defects/35cases,0complete release cases/gates. Private217 dashboard204/source8d5ae167 succeeded with one owner/zero external visitors/groups; source90eb439 complete same-device bundle/fresh clean restore/fsck/index passed. Exact next: complete218 backup/private publication preserving browser notes, then implement approved company settings/history/preview with current admin/company authorization; remaining catalogue/staff/native work toward49/97. Generated admin next-env.d.ts unstaged. No app source push/Actions rerun, device/operator/provider/rights/cutover acceptance or purchases/credits/reset/plan changes. Owner:Boniface+Codex.\n\n' +
      (await readFile(target, 'utf8')),
  );
}
await writeFile(
  new URL('docs/ACTIVE-WORK.md', root),
  '# Active work —218 design complete; continue toward50%\n\n' +
    summary +
    '\n\nFeature8d3fa7f local. One-shot218 run; never rerun over later notes. Owned3119 preview and tab14 closed, user dashboard untouched; admin next-env.d.ts generated and unstaged. Exact next: finish218 backup/private publication then implement approved company settings/history/preview with current admin/company authorization, current-version/original-operation recovery and meaningful audit. Remaining staff/catalogue/native work stays open. No device/provider/operator/rights/cutover gate or app source push/Actions rerun/paid/credit/plan change. Owner:Boniface+Codex.\n',
);
console.log(JSON.stringify({ done: 43, total: 97, notes: 695, gates: 0 }));
