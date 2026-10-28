/** One-shot, evidence-backed checkpoint; refuses another baseline or a second run. */
import { readFile, writeFile, copyFile, cp, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
assert.equal(plan.baselineRevision, 'mobile-offline-2026-10-28-211');
const tasks = plan.stages.flatMap((stage) => stage.tasks);
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((task) => task.done).length, 35);
assert.equal(
  plan.stages.reduce((count, stage) => count + stage.notes.length, 0),
  681,
);
const task = tasks.find((task) => task.id === '08-6');
assert.equal(task.done, false);
const summary =
  'Checkpoint212 (28 October 2026): completed the actionable admin operations overview (08-6): stale available stock, pending reviews, overdue enquiries and ended confirmed viewings. Bounded current admin/company SQL reads and fresh authorized action links; actual synthetic browser outcome/review changes disappear after refresh, foreign target denied, narrow keyboard layout checked. API297/297, SDK300/300, domain296/296, admin437+30 and signed HTTP89/89 passed; admin TypeScript/full production build passed. 36/97 tasks (37% rounded),0/14 gates. Thirteen more whole tasks needed to cross50%; devices, operator UAT, rights/provider/cutover evidence remain open.';
const evidence = 'realtor-platform/docs/evidence/2026-10-28-operations-overview.md';
task.done = true;
task.evidence += `\n\nAccepted checkpoint212,28 October2026: ${summary} Evidence:${evidence}. Stale positive/truncation paths proved by restricted SQL and rendered-link checks; browser fixture stock queue was empty. Counts are displayed items, not inferred totals. No real notifications, image-quality, device, operator or release acceptance implied.`;
for (const id of ['05', '08'])
  plan.stages
    .find((stage) => stage.id === id)
    .notes.push({
      date: '28 October 2026',
      author: 'Codex',
      text: `${summary} Evidence:${evidence}. Next: publish owner-private dashboard preserving browser notes; continue media lifecycle/cleanup and remaining dependency-ready implementation. Owner:Boniface+Codex.`,
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'operations-overview-2026-10-28-212';
plan.baseline = summary;
assert.equal(tasks.filter((task) => task.done).length, 36);
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
await writeFile(
  new URL('dist/plan-data.js', dashboard),
  `window.REALTOR_PLAN=${JSON.stringify(plan)};\n`,
);
const planDoc = new URL('DELIVERY-PLAN.md', dashboard);
await writeFile(
  planDoc,
  (await readFile(planDoc, 'utf8')).replace(
    '# Realtor Platform Rebuild — Delivery Plan',
    `# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint — 28 October 2026 (212)\n\n${summary} Evidence:${evidence}.`,
  ),
);
await copyFile(planDoc, new URL('dist/DELIVERY-PLAN.md', dashboard));
await copyFile(
  new URL('../docs/evidence/2026-10-28-operations-overview.md', import.meta.url),
  new URL('dist/OPERATIONS-OVERVIEW212.md', dashboard),
);
await cp(
  new URL('../docs/evidence/2026-10-28-operations-overview/', import.meta.url),
  new URL('dist/2026-10-28-operations-overview/', dashboard),
  { recursive: true },
);
await mkdir(new URL('dist/2026-10-28-mobile-offline/', dashboard), { recursive: true });
await copyFile(
  new URL('../docs/evidence/2026-10-28-mobile-offline/publication.json', import.meta.url),
  new URL('dist/2026-10-28-mobile-offline/publication.json', dashboard),
);
for (const name of [
  'api-full.txt',
  'sdk-full.txt',
  'domain-full.txt',
  'admin-tests-fixed.txt',
  'signed-http-full.txt',
  'admin-build.txt',
  'narrow-overview-verified.jpg',
])
  await copyFile(
    new URL(`../docs/evidence/2026-10-28-operations-overview/${name}`, import.meta.url),
    new URL(`dist/operations212-${name}`, dashboard),
  );
const htmlPath = new URL('dist/index.html', dashboard);
const html = await readFile(htmlPath, 'utf8');
assert.match(html, /<section class="checkpoint"/);
await writeFile(
  htmlPath,
  html.replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">28 OCTOBER · VERIFIED DAILY OPERATIONS</span><h2>A clear queue for work that needs attention.</h2><p>Admins can find stale stock, pending submissions, overdue follow-ups and ended viewings. Each action opens a fresh authorized record; completed fictional work leaves the queue after refresh.</p><p>36 of 97 tasks complete · 37% rounded. Your 50% target needs 13 more whole tasks. Production and release gates remain open.</p><a href="OPERATIONS-OVERVIEW212.md">Read checkpoint evidence →</a></div><div class="checkpoint-metrics"><strong>297 API + 300 client checks</strong><span>+ 296 domain checks</span><strong>437 + 30 admin checks</strong><span>+ 89 signed HTTP checks and production build</span><strong>0 of 14 release gates</strong><span>No device, operator UAT or cutover pass claimed</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL(`../docs/${name}`, import.meta.url);
  await writeFile(
    path,
    `## Latest checkpoint 212 — 28 October 2026\n\n${summary} Evidence:[operations overview](evidence/2026-10-28-operations-overview.md). Checkpoint211 owner-private dashboard version198/sourceeaf99bf succeeded, access one owner/zero visitors/groups; source9aedc88 same-device complete bundle/fresh clone/fsck passed. No GitHub push/Actions rerun. Current source212 should be committed/backed up locally, then publish the same private dashboard. Generated admin next-env.d.ts stays unstaged. Exact next: continue media lifecycle/cleanup and remaining connected web/admin/native work toward50%; keep physical devices, rights/accounts, operator UAT, hosting and cutover gates open. Owner:Boniface+Codex.\n\n${await readFile(path, 'utf8')}`,
  );
}
console.log(JSON.stringify({ done: 36, total: 97, notes: 683, acceptedGates: 0 }));
