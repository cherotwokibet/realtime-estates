/** One-shot checkpoint; preserve all existing task decisions and notes. */
import { readFile, writeFile, copyFile, cp, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url),
  dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard),
  plan = JSON.parse(await readFile(planPath, 'utf8'));
const tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'viewing-calendar-2026-10-28-214');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 38);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  687,
);
const summary =
  'Checkpoint215 (28 October2026): implemented restricted expired-unverified media authorization and offline owned-byte retirement fences. Exact company pages, preserved original operations/receipts, verified-media protection, no raw API/worker grants, uncertainty handling and path/link checks passed. Full media205/205 and corrected default-schema SQL350/350 passed; earlier inventory failures retained and corrected with exact seven-processing/two-maintenance permissions. Whole-pipeline live quiescence and incomplete decoder-workspace cleanup remain open, so06-3/06-7 stay unchecked.38/97tasks(39%rounded),0/14gates;11more whole tasks needed for50%.';
const evidence = 'realtor-platform/docs/evidence/2026-10-28-expired-media-cleanup.md';
for (const id of ['06-3', '06-7']) {
  const task = tasks.find((t) => t.id === id);
  assert.equal(task.done, false);
  task.evidence += `\n\nCheckpoint215 partial implementation: ${summary} Source0595a6f; evidence:${evidence}. Never infer live worker death or cleanup authority from historical journals. No production sweeper/retention/device/operator acceptance.`;
}
for (const id of ['06', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '28 October2026',
      author: 'Codex',
      text: `${summary} Evidence:${evidence}. Next: live supervisor retirement/quiescence capability, then exact owned incomplete-attempt cleanup and image-backed browser matrix. Owner:Boniface+Codex.`,
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'expired-media-foundation-2026-10-28-215';
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
    `# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —28October2026 (215)\n\n${summary} Evidence:${evidence}.`,
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
await copyFile(
  new URL('docs/evidence/2026-10-28-expired-media-cleanup.md', root),
  new URL('dist/evidence/2026-10-28-expired-media-cleanup.md', dashboard),
);
await cp(
  new URL('docs/evidence/2026-10-28-expired-media-cleanup/', root),
  new URL('dist/evidence/2026-10-28-expired-media-cleanup/', dashboard),
  { recursive: true },
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">28 OCTOBER · SAFE UPLOAD LIFECYCLE</span><h2>Expired bytes can be fenced without erasing history.</h2><p>Restricted maintenance protects every verified image and keeps operation receipts. Exact owned-file checks and uncertain-commit handling were exercised with synthetic data. The live worker safety step remains open.</p><p>38 of97 tasks complete ·39% rounded. Your50% target needs11 more whole tasks. This partial cleanup work has not been counted as another completed task.</p><a href="evidence/2026-10-28-expired-media-cleanup.md">Read executed checks and remaining work →</a><br><a href="acceptance-status.html#AC-005">Explore upload acceptance evidence →</a></div><div class="checkpoint-metrics"><strong>205 media checks passed</strong><span>Actual codec/supervisor and SQL/filesystem cases plus doubles</span><strong>350 SQL checks passed</strong><span>Corrected full default-schema regression; failures retained</span><strong>0 of14 release gates</strong><span>No enabled production sweeper or device/operator acceptance</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const target = new URL('docs/' + name, root);
  await writeFile(
    target,
    `## Latest checkpoint215 —28October2026\n\n${summary} Evidence:[expired media cleanup](evidence/2026-10-28-expired-media-cleanup.md). Feature0595a6f stays local. Calendar214 owner-private dashboard version201/source5fa7ffc succeeded with one owner/zero visitors/zero groups; source3d49424 complete same-device bundle/fresh restore/fsck/ledger check passed. Exact next: persist/back up215 and publish same private dashboard preserving browser notes, then build a live same-instance supervisor retirement fence, drain upload/finalize/image work and refuse cleanup on any unconfirmed containment; remove only eligible exact job-owned incomplete decoder files after committed SQL authorization. Historical journals never grant new cleanup authority. Continue full image-backed0/3/4/12/13/interrupted3-of4 checks, connected public gallery and remaining local scope toward50%. No new device/browser/provider/operator/rights/cutover gate, GitHub push/Actions rerun, service purchase, reset credit or plan change. Owner:Boniface+Codex.\n\n${await readFile(target, 'utf8')}`,
  );
}
console.log(
  JSON.stringify({
    done: 38,
    total: 97,
    notes: 689,
    acceptedGates: 0,
    mediaPassed: 205,
    databasePassed: 350,
  }),
);
