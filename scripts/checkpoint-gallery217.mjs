/** One-shot checkpoint217; never rerun over later canonical/browser progress. */
import { readFile, writeFile, copyFile, cp, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url),
  dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard),
  plan = JSON.parse(await readFile(planPath, 'utf8'));
const tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'live-media-recovery-2026-10-29-216');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 40);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  691,
);
const summary =
  'Checkpoint217 (29 October2026): completed the locally verified connected public gallery (07-3). Anonymous image reads require current approved/fresh publication and exact native sealed provenance before and after I/O; private staff authority is never reused. Actual4-image native upload/approval/decode/pause and browser deferred-image denial/notfound/explicit-resume recovery passed. Keyboard expansion,320/390px exact fees and area privacy verified. Full API307/307, SQL353/353, signed HTTP96/96, web107/107 and final one-worker production build passed.41/97tasks(42%rounded),0/14gates;8more whole tasks needed for50%.';
const evidence = 'realtor-platform/docs/evidence/2026-10-29-public-gallery.md';
const task = tasks.find((t) => t.id === '07-3');
assert.equal(task.done, false);
task.done = true;
task.evidence +=
  '\n\nAccepted217 as local implementation/browser verification. ' +
  summary +
  ' Feature0951abc2ce40f0390b16c7c856e46addc628ed45; ' +
  evidence +
  '. Production media provider/retention, actual devices/full accessibility/operator/rights/cutover remain separate open work. No fabricated exact confirmation timestamp and no release gate accepted.';
for (const id of ['07', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '29 October2026',
      author: 'Codex',
      text:
        summary +
        ' Evidence:' +
        evidence +
        '. Owned preview/tab closed; original browser notes retained. Next: complete connected responsive public/staff design handoff and remaining normalized catalogue/admin/native work toward50%. No app source push/Actions, purchase/credit/reset/plan changes. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'current-public-gallery-2026-10-29-217';
plan.baseline = summary;
await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n');
await writeFile(
  new URL('dist/plan-data.js', dashboard),
  'window.REALTOR_PLAN=' + JSON.stringify(plan) + ';\n',
);
const planDoc = new URL('DELIVERY-PLAN.md', dashboard);
await writeFile(
  planDoc,
  (await readFile(planDoc, 'utf8')).replace(
    '# Realtor Platform Rebuild — Delivery Plan',
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —29October2026 (217)\n\n' +
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
await cp(
  new URL('docs/evidence/2026-10-29-public-gallery/', root),
  new URL('dist/evidence/2026-10-29-public-gallery/', dashboard),
  { recursive: true },
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">29 OCTOBER · CONNECTED PUBLIC GALLERY</span><h2>Public photos follow the current listing status.</h2><p>Four real synthetic uploads now reach the public gallery. A paused listing stops new image reads and disappears on refresh; an explicit resume restores it. Keyboard expansion and narrow layouts keep costs and location privacy clear.</p><p>41 of97 tasks complete ·42% rounded. Eight more whole tasks are needed for50%. Production providers, actual devices and operator approval remain open.</p><a href="evidence/2026-10-29-public-gallery.md">Read executed checks and limits →</a><br><a href="evidence/2026-10-29-public-gallery/desktop-restored.jpg">View the verified gallery →</a><br><a href="acceptance-status.html#AC-019">Explore image access evidence →</a></div><div class="checkpoint-metrics"><strong>307 API ·353 SQL passed</strong><span>Current publication, provenance, tenancy and retained private authority</span><strong>96 HTTP ·107 web passed</strong><span>Actual native images, browser recovery and production build</span><strong>0 of14 release gates</strong><span>No physical device, production provider or operator acceptance</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const target = new URL('docs/' + name, root);
  await writeFile(
    target,
    '## Latest checkpoint217 —29October2026\n\n' +
      summary +
      ' Evidence:[current public gallery](evidence/2026-10-29-public-gallery.md). Feature0951abc stays local. Maintained ledger24executions/6fixed defects/35cases,0complete release cases/gates. Owned public tab13/preview57659 closed; generated admin next-env.d.ts stays unstaged. Private216 dashboard203/source dcdfd7e deployed with one owner/zero visitors/groups; complete source f3426cf same-device bundle/fresh clean restore/fsck/index check passed. Exact next: complete217 source backup and same owner-private dashboard publication preserving browser notes; then connected responsive public/staff design handoff, normalized catalogue and remaining admin/native implementation toward49/97. No app source push/Actions rerun, production provider/device/operator/rights/cutover acceptance or paid/credit changes. Owner:Boniface+Codex.\n\n' +
      (await readFile(target, 'utf8')),
  );
}
await writeFile(
  new URL('docs/ACTIVE-WORK.md', root),
  '# Active work —checkpoint217 complete locally; continue toward50%\n\n' +
    summary +
    '\n\nFeature0951abc2ce40f0390b16c7c856e46addc628ed45 remains local. One-shot217 has run: never rerun216/217 over later notes. Exact next: backup/publish217 to existing one-owner private dashboard, then complete the connected public/staff responsive design handoff (03-4/03-5, operator review03-7 separate), remaining catalogue/admin/native work. No new task accepted beyond07-3; target49/97 not achieved.\n\nAll current checks/logs/browser screenshots and limits are in docs/evidence/2026-10-29-public-gallery.md. Browser13 and owned3118 preview stopped. User dashboard tab untouched. Generated admin next-env.d.ts unstaged; no new subagents. Full source f3426cf backup and216 private203 publication verified in prior journal. Keep local app source while Actions exhausted; no purchases/credits/reset/plan changes or vendor/live cutover. Owner:Boniface+Codex.\n',
);
console.log(JSON.stringify({ done: 41, total: 97, notes: 693, acceptedGates: 0 }));
