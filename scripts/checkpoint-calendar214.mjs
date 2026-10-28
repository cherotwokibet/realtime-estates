/** One-shot canonical checkpoint. Never rerun over later progress. */
import { readFile, writeFile, copyFile, cp, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const source = new URL('../', import.meta.url);
const dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'acceptance-traceability-2026-10-28-213');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 37);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  685,
);
const viewing = tasks.find((t) => t.id === '08-3');
assert.equal(viewing.done, false);
const summary =
  'Checkpoint214 (28 October2026): completed the local viewing request/calendar lifecycle and notification failure visibility (08-3). Current company/assignment-protected Nairobi agenda, unscheduled queue and fresh inspection links verified through reschedule, renewed phone agreement, cancellation, six retained history states and reassignment. Capture-only uncertainty recovered the original result; external delivery remains explicitly unavailable. Domain299/299, API301/301, SDK303/303, admin437+33 and actual signed HTTP90/90 passed; full admin production build including TypeScript passed.38/97tasks(39%rounded),0/14gates;11more whole tasks needed to cross50%. No provider delivery/device/operator/rights/cutover acceptance.';
const evidence = 'realtor-platform/docs/evidence/2026-10-28-viewing-calendar.md';
viewing.done = true;
viewing.evidence += `\n\nAccepted local implementation checkpoint214: ${summary} Evidence:${evidence}; source842f493. Provider/consent/cadence/reconciliation and native/operator UAT remain in AC-017 and release gates; no delivered-notification claim.`;
for (const id of ['08', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '28 October2026',
      author: 'Codex',
      text: `${summary} Evidence:${evidence}. Next: safe incomplete-media lifecycle/reference protection and full image-backed boundary/recovery browser checks. Owner:Boniface+Codex.`,
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'viewing-calendar-2026-10-28-214';
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
    `# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —28October2026 (214)\n\n${summary} Evidence:${evidence}.`,
  ),
);
await copyFile(planDoc, new URL('dist/DELIVERY-PLAN.md', dashboard));
const ledger = JSON.parse(await readFile(new URL('docs/acceptance-status.json', source), 'utf8'));
for (const name of ['acceptance-status.html', 'acceptance-status.md', 'acceptance-status.json'])
  await copyFile(new URL('docs/' + name, source), new URL('dist/' + name, dashboard));
for (const r of Object.values(ledger.executions)) {
  const target = new URL('dist/' + r.path.replace(/^docs\//, ''), dashboard);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(r.path, source), target);
}
await cp(
  new URL('docs/evidence/2026-10-28-viewing-calendar/', source),
  new URL('dist/evidence/2026-10-28-viewing-calendar/', dashboard),
  { recursive: true },
);
const htmlPath = new URL('dist/index.html', dashboard);
const html = await readFile(htmlPath, 'utf8');
assert.match(html, /<section class="checkpoint"/);
await writeFile(
  htmlPath,
  html.replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">28 OCTOBER · VIEWING WORKFLOW</span><h2>A current calendar with a clear next action.</h2><p>View scheduled slots and unscheduled requests in Nairobi time. Fresh inspection links retain authorization, deliberate saves and saved history. Reassignment removes former-agent access.</p><p>38 of97 tasks complete ·39% rounded. Your50% target needs11 more whole tasks. External notification delivery, devices and operator acceptance remain open.</p><a href="evidence/2026-10-28-viewing-calendar.md">Read executed checks and remaining limits →</a><br><a href="acceptance-status.html#AC-017">Explore acceptance evidence →</a></div><div class="checkpoint-metrics"><strong>90 signed HTTP checks</strong><span>Actual local service and restricted SQL; synthetic companies</span><strong>History and access verified</strong><span>Proposal, agreement, cancellation and reassignment</span><strong>0 of14 release gates</strong><span>Capture-only testing sends no notifications</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL('docs/' + name, source);
  await writeFile(
    path,
    `## Latest checkpoint214 —28October2026\n\n${summary} Evidence:[viewing calendar](evidence/2026-10-28-viewing-calendar.md). Feature842f493 remains local;213 dashboard version200/source279534c succeeded under one-owner/zero-visitor/zero-group access. Exact next: complete local214 backup and same private dashboard publication while preserving browser notes, then safe incomplete/expired media cleanup with reference protection, image-backed boundary/recovery checks and remaining connected product work. Never infer full AC-017/device/provider/operator/rights/cutover acceptance. No GitHub push/Actions rerun, paid services, credits/reset or plan change. Owner:Boniface+Codex.\n\n${await readFile(path, 'utf8')}`,
  );
}
console.log(
  JSON.stringify({ done: 38, total: 97, notes: 687, acceptedGates: 0, completeReleaseCases: 0 }),
);
