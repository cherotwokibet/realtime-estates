/** One-shot219: local CI conservation; do not rerun over later canonical/browser progress. */
import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url),
  dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const target = new URL('dist/plan.json', dashboard),
  plan = JSON.parse(await readFile(target, 'utf8'));
assert.equal(plan.baselineRevision, 'connected-design-2026-10-29-218');
assert.equal(plan.stages.flatMap((s) => s.tasks).filter((t) => t.done).length, 43);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  695,
);
const summary =
  'Checkpoint219 (29October2026): prepared conservative CI efficiency locally. Documentation/tracker-only updates avoid application installation/tests/bundles; runtime changes retain full tests/types and select affected frontend builds. Unknown/missing Git history runs all; superseded-run cancellation, pinned actions/cache and required verify result retained;30minute timeout/manual full added. Planner8/8 and whole-repository format passed; original UAT hash preserved. User requested local development before1November: no source push, hosted Actions, spending-limit/plan/credit change or claimed dollar saving.43/97tasks(44%rounded),0/14gates;6more whole tasks needed for50%. Company settings is implemented locally with SQL357/API307/domain301/admin444+34/web109 and signed3 proof, but final builds/browser verification remain before08-5 acceptance.';
for (const id of ['04', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '29October2026',
      author: 'Codex',
      text:
        summary +
        ' Evidence:realtor-platform/docs/ci-efficiency.md; sourceCI84067fe, company-settings WIPc17256f. Full/focused totals overlap and are not complete case/gate passes. Preserve original browser notes and old live/vendor resources. Next: finish settings production builds and actual browser save/recovery/conflict/current public readback/320px checks, then remaining catalogue/native scope. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'local-ci-conservation-2026-10-29-219';
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
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —29October2026 (219)\n\n' +
      summary +
      ' See realtor-platform/docs/ci-efficiency.md.',
  ),
);
await copyFile(doc, new URL('dist/DELIVERY-PLAN.md', dashboard));
await copyFile(new URL('docs/ci-efficiency.md', root), new URL('dist/ci-efficiency.md', dashboard));
for (const name of ['acceptance-status.html', 'acceptance-status.md', 'acceptance-status.json'])
  await copyFile(new URL('docs/' + name, root), new URL('dist/' + name, dashboard));
const ledger = JSON.parse(await readFile(new URL('docs/acceptance-status.json', root), 'utf8'));
for (const record of Object.values(ledger.executions)) {
  const out = new URL('dist/' + record.path.replace(/^docs\//, ''), dashboard);
  await mkdir(new URL('./', out), { recursive: true });
  await copyFile(new URL(record.path, root), out);
}
await cp(
  new URL('docs/evidence/2026-10-29-ci-efficiency/', root),
  new URL('dist/evidence/2026-10-29-ci-efficiency/', dashboard),
  { recursive: true },
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">29 OCTOBER · LOCAL DEVELOPMENT / CI BUDGET</span><h2>Keep building locally; use hosted CI deliberately.</h2><p>Prepared conservative CI planning so tracker/evidence updates avoid full application builds. Runtime changes keep all tests and types. No GitHub source push, hosted run or account-budget change before the requested November1 checkpoint.</p><p>43 of97 tasks complete ·44% rounded. Company settings has passed local database/API/UI logic checks; production builds and browser journeys remain before acceptance. Six whole tasks still needed to cross50%.</p><a href="ci-efficiency.md">Read the local CI changes and8-test proof →</a><br><a href="design/connected-journeys.html">Explore the completed design handoff →</a><br><a href="acceptance-status.html">Inspect actual evidence and open release gaps →</a></div><div class="checkpoint-metrics"><strong>8 CI planner tests passed locally</strong><span>Complete Git diffs, conservative fallback and evidence preservation</span><strong>Settings verification continues</strong><span>Not counted complete before actual browser/build checks</span><strong>0 of14 release gates</strong><span>No hosted CI, production provider, device or operator pass inferred</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL('docs/' + name, root);
  await writeFile(
    path,
    '## Latest checkpoint219 —29October2026\n\n' +
      summary +
      ' Evidence:[CI conservation](ci-efficiency.md), [pending company settings](evidence/2026-10-29-company-settings.md). Source CI84067fe; unaccepted settingsc17256f local. Ledger26executions/6fixed defects/35incomplete cases,0gates. Private218 dashboard205/source3a2f2bf with one owner/zero visitors/groups and complete source5cf348d same-device restored backup verified. Exact next: preserve/publish219 status retaining browser notes, then finish settings full admin/web production builds and actual browser save/lost-reply/conflict/public readback/320px evidence. Do not count08-5 early. No new connected Android device/emulator, vendor/live cutover, app source push/Actions before1November, or financial/credential/plan change. Owner:Boniface+Codex.\n\n' +
      (await readFile(path, 'utf8')),
  );
}
console.log(
  JSON.stringify({
    done: 43,
    total: 97,
    notes: 697,
    gates: 0,
    ciSourceLocalOnly: true,
    settingsAccepted: false,
  }),
);
