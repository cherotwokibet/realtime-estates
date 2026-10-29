/** One-shot221; refuse a later canonical baseline. */
import { readFile, writeFile, copyFile, mkdir, cp } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url),
  dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url),
  target = new URL('dist/plan.json', dashboard);
const proof = JSON.parse(
  await readFile(new URL('docs/evidence/2026-10-29-preservation/verification.json', root), 'utf8'),
);
assert.equal(proof.status, 'completed');
assert.equal(proof.complete, true);
assert.equal(proof.expectedFiles, 2254);
assert.equal(proof.verifiedFiles, 2254);
assert.equal(proof.archives.length, 4);
assert.ok(proof.archives.every((a) => a.matches && a.readOnlyMode));
for (const k of ['sourceChanges', 'unlistedFiles', 'unfollowedLinks', 'failures'])
  assert.equal(proof[k].length, 0);
const plan = JSON.parse(await readFile(target, 'utf8')),
  tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'approved-company-settings-2026-10-29-220');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 44);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  699,
);
const summary =
  'Checkpoint221 (29October2026): completed original-resource inventory/read-only preservation01-1. Streamed byte-for-byte length/SHA256 checks matched all2254 files across the four supplied roots and all four original read-only ZIP archives; no missing/changed/unlisted/unstable/link entry, original write or archive replacement. Pinned manifest and explicit exclusions retained. These are preservation facts, not old UAT/application/rights/account/offsite-backup passes.45/97tasks(46%rounded),0/14gates;4more whole tasks needed to cross50%. App/CI source remains local before1November; no hosted Actions, purchase/credit/plan/credential or vendor/live change.';
const task = tasks.find((t) => t.id === '01-1');
assert.equal(task.done, false);
task.done = true;
task.evidence +=
  '\n\nAccepted221 with full current local file/readonly archive reconciliation. ' +
  summary +
  ' Feature895a95587932789f7249df2f741442b83695fd20; realtor-platform/docs/evidence/2026-10-29-preservation.md. Original source bytes/assets/code are preserved only; rights/design audit/authorized data export/production restore/cutover stay separate and open.';
for (const id of ['01', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '29October2026',
      author: 'Codex',
      text:
        summary +
        ' Evidence:realtor-platform/docs/evidence/2026-10-29-preservation.md and structured verification.json. No vendor implementation copied into replacement apps. Next: preserve/publish221 status, then dependency-ready public/native/performance work and controlled catalogue deployment composition without inventing hosted evidence. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'original-preservation-2026-10-29-221';
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
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —29October2026 (221)\n\n' +
      summary +
      ' Evidence:realtor-platform/docs/evidence/2026-10-29-preservation.md.',
  ),
);
await copyFile(doc, new URL('dist/DELIVERY-PLAN.md', dashboard));
for (const name of ['acceptance-status.html', 'acceptance-status.md', 'acceptance-status.json'])
  await copyFile(new URL('docs/' + name, root), new URL('dist/' + name, dashboard));
const ledger = JSON.parse(await readFile(new URL('docs/acceptance-status.json', root), 'utf8'));
for (const record of Object.values(ledger.executions)) {
  const out = new URL('dist/' + record.path.replace(/^docs\//, ''), dashboard);
  await mkdir(new URL('./', out), { recursive: true });
  await copyFile(new URL(record.path, root), out);
}
await copyFile(
  new URL('docs/evidence/2026-10-29-preservation.md', root),
  new URL('dist/evidence/2026-10-29-preservation.md', dashboard),
);
await cp(
  new URL('docs/evidence/2026-10-29-preservation/', root),
  new URL('dist/evidence/2026-10-29-preservation/', dashboard),
  { recursive: true },
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">29 OCTOBER · ORIGINAL RESOURCES PRESERVED</span><h2>Every supplied original still matches its preserved record.</h2><p>All2,254 source, APK, design, proposal, media and historical UAT files matched the pinned inventory. All four original read-only archives matched their byte lengths and checksums. This confirms preservation, not asset rights or old UAT acceptance.</p><p>45 of97 tasks complete ·46% rounded. Four more whole tasks are needed to cross50%. Application and CI development stays local before November1; release gates remain open.</p><a href="evidence/2026-10-29-preservation.md">Read the full preservation evidence →</a><br><a href="evidence/2026-10-29-company-settings.md">Review completed company settings checks →</a><br><a href="evidence/2026-10-29-company-settings/admin-desktop-top.jpg">View the implemented editor →</a><br><a href="ci-efficiency.md">Review local CI conservation →</a></div><div class="checkpoint-metrics"><strong>2,254 of2,254 files matched</strong><span>No missing, changed or unlisted original in the declared inventory</span><strong>4 read-only archive checksums matched</strong><span>No source overwrite, archive replacement or vendor-code reuse</span><strong>0 of14 release gates</strong><span>Rights, real accounts, devices, operator and cutover remain open</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL('docs/' + name, root);
  await writeFile(
    path,
    '## Latest checkpoint221 —29October2026\n\n' +
      summary +
      ' Evidence:[original preservation](evidence/2026-10-29-preservation.md). Feature895a955 local; ledger35executions/6fixed defects/35incomplete cases,0gates. Private220 dashboard207/source98cae7ec succeeded under one owner/zero visitors/groups; complete source97362e0 same-device all-ref bundle/fresh clean restore/fsck/34execution check passed. Exact next: finish221 backup/private status publication preserving browser notes, then define and measure local representative-inventory/API/web load budgets and verify remaining public keyboard/narrow/native journeys. Controlled reference deployment composition/attestation/drain/owner DDL lease/reconciliation/hosted concurrency still open; do not promote default-off proposals blindly. Generated web next-env.d.ts remains unstaged; no owned server/emulator active. Temporary owned error-tab4 closure could not be confirmed; unmarked for automatic cleanup, user dashboard untouched. No GitHub app-source push/Actions before1November, purchases/reset/plan/credential changes or old-live cutover. Owner:Boniface+Codex.\n\n' +
      (await readFile(path, 'utf8')),
  );
}
await writeFile(
  new URL('docs/ACTIVE-WORK.md', root),
  '# Active work —221 original preservation complete; continue toward50%\n\n' +
    summary +
    '\n\nFeature895a955 local. One-shot221 run; never replay220/221 over later notes. Verification doc/final JSON cover2254 files and four ReadOnly ZIPs, code-only read/no original changes. No original UAT PASS imported. Current plan45/97,701notes,0gates,35execution ledger. Exact next: complete221 source backup/private publication, then define representative local performance/load budgets before measuring and run current public keyboard/narrow/boundary/native journeys. Read apps/api/dev/journey-fixtures.mjs, reference-public launch config and existing search evidence before extending fixtures. Reference deployment admission174 is only an isolated utility; actual controlled deployment/artifact attestation/drain/ownerDDL serialization/exclusive lease/reconciliation/hosted concurrency remain open, so06-1 cannot be marked merely by counting its default-off proposals.\n\nAll owned3120/3121/API previews stopped; no dev locks/emulator. One temporary error tab4 remains unmarked after Browser URL guard closure refusal;2/3/5 closed and user dashboard tab1/notes untouched. Generated web next-env.d.ts stays unstaged. Keep source/CI local before1November, no paid/credit/reset/plan/account changes or vendor/live edits. Owner:Boniface+Codex.\n',
);
console.log(JSON.stringify({ done: 45, total: 97, notes: 701, gates: 0 }));
