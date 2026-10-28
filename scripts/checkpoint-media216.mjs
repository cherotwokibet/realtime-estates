/** One-shot checkpoint216. Never rerun over later canonical or browser progress. */
import { readFile, writeFile, copyFile, cp, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'expired-media-foundation-2026-10-28-215');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 38);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  689,
);
const summary =
  'Checkpoint216 (28–29 October2026 EAT): completed local upload lifecycle and boundary/recovery verification (06-3/06-7). Live original-instance supervisor retirement/drain and exact SQL-authorized incomplete workspace cleanup preserve verified media, references, receipts and uncertainty. Browser Cancel during third upload retained two photos; corrupt input refused, leave-unattached preserved gallery,0/3 submit refused,4/12 distinct images decoded,12 submitted pending and thirteenth API attachment refused without mutation. Fixed closed-admission and failed-native original-readback defects. Full media207/207, signed HTTP95/95, admin441+33 and final full production build passed.40/97tasks(41%rounded),0/14gates;9more whole tasks needed for50%.';
const evidence = 'realtor-platform/docs/evidence/2026-10-28-live-media-retirement.md';
for (const id of ['06-3', '06-7']) {
  const task = tasks.find((t) => t.id === id);
  assert.equal(task.done, false);
  task.done = true;
  task.evidence +=
    '\n\nAccepted216 as locally verified implementation/testing only. ' +
    summary +
    ' Feature1a2e18e714f2593284fe9511e39feed375263ff7; ' +
    evidence +
    '. Production retention/schedule/alerts, hosted isolation, physical devices/operator/rights/cutover remain open; no stage exit gate accepted.';
}
for (const id of ['06', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '29 October2026 (work began28October)',
      author: 'Codex',
      text:
        summary +
        ' Evidence:' +
        evidence +
        '. Next: connected accessible public sealed-image gallery with current-publication checks before/after I/O; continue toward50%. No GitHub push/Actions rerun or paid/credit changes. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'live-media-recovery-2026-10-29-216';
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
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —29October2026 (216)\n\n' +
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
for (const folder of ['2026-10-28-live-media-retirement', '2026-10-28-upload-browser-matrix'])
  await cp(
    new URL('docs/evidence/' + folder + '/', root),
    new URL('dist/evidence/' + folder + '/', dashboard),
    { recursive: true },
  );
await copyFile(
  new URL('docs/local-media-maintenance-runbook.md', root),
  new URL('dist/local-media-maintenance-runbook.md', dashboard),
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">29 OCTOBER · UPLOAD RECOVERY VERIFIED</span><h2>Cancel, recover and keep saved photos intact.</h2><p>The third upload was cancelled in the browser and its original result recovered. Corrupt images were refused, twelve distinct photos displayed, and an extra attachment was rejected. Controlled cleanup now waits for the original worker to stop.</p><p>40 of97 tasks complete ·41% rounded. Nine more whole tasks are needed for50%. Physical devices, production lifecycle and operator approval remain open.</p><a href="evidence/2026-10-28-live-media-retirement.md">Read checks, corrections and limits →</a><br><a href="acceptance-status.html#AC-005">Explore maintained upload evidence →</a></div><div class="checkpoint-metrics"><strong>207 media checks passed</strong><span>Actual codec/supervisor and SQL/filesystem cases plus doubles</span><strong>95 signed HTTP checks passed</strong><span>Includes actual thirteen-image capacity and duplicate recovery</span><strong>0 of14 release gates</strong><span>Local task completion does not establish launch readiness</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const target = new URL('docs/' + name, root);
  let prior = await readFile(target, 'utf8');
  if (name === 'CONTINUATION.md')
    prior = prior.replace(/^## Active implementation216[\s\S]*?(?=## Latest checkpoint215)/, '');
  await writeFile(
    target,
    '## Latest checkpoint216 —29October2026\n\n' +
      summary +
      ' Evidence:[live media retirement and upload recovery](evidence/2026-10-28-live-media-retirement.md). Feature1a2e18e stays local. Maintained ledger19executions/6fixed defects/35cases,0complete release cases/gates. Browser tabs and owned preview closed; generated admin next-env.d.ts stays unstaged. Private215 dashboard202/source6cb57c1/one owner/zero visitors/groups and full source5ce9b8b same-device backup verified. Exact next: complete216 backup and same owner-private dashboard publication preserving browser notes, then public sealed-image gallery with current approved/fresh eligibility before and after I/O; continue normalized catalogue and remaining dependency-ready scope toward50%. No external provider/device/operator/rights/cutover acceptance or app source push/Actions rerun. Owner:Boniface+Codex.\n\n' +
      prior,
  );
}
await writeFile(
  new URL('docs/ACTIVE-WORK.md', root),
  '# Active work —checkpoint216 complete locally; next217\n\n' +
    summary +
    '\n\nFeature1a2e18e714f2593284fe9511e39feed375263ff7 is local. Source metadata/backup and private dashboard publication are next; do not rerun one-shot checkpoint216. See CONTINUATION.md and dated evidence for all actual checks and limits. User target remains49/97 tasks for50%, not achieved yet. No new subagents.\n\nNext implementation: connected public accessible gallery for current approved/available/fresh published stock. Current public photo DTO contains key/alt but connected web says image unavailable. Private/review media primitives exist; preserve sealed provenance/current publication before and after I/O, company isolation and no private draft authority. No production account, real media, purchase, credit/reset or live cutover. Keep original report and browser notes intact. Generated admin next-env.d.ts unstaged; no owned server/tab remains. Owner:Boniface+Codex.\n',
);
console.log(JSON.stringify({ done: 40, total: 97, notes: 691, acceptedGates: 0 }));
