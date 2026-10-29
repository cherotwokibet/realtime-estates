/** One-shot220; never replay over later canonical/browser state. */
import { readFile, writeFile, copyFile, mkdir, cp } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url),
  dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url),
  target = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(target, 'utf8')),
  tasks = plan.stages.flatMap((s) => s.tasks);
assert.equal(plan.baselineRevision, 'local-ci-conservation-2026-10-29-219');
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((t) => t.done).length, 43);
assert.equal(
  plan.stages.reduce((n, s) => n + s.notes.length, 0),
  697,
);
const summary =
  'Checkpoint220 (29October2026): completed locally verified approved company content/settings and branding preview08-5. Current admin/company authorization, immutable approval/audit, exact version/original recovery and anonymous current public copy/palette are connected. Browser lost-reply recovery, two-tab conflict/rebase/adoption, keyboard approval, extreme palette and320/390px public readback passed. Final domain302, API307, default SQL357, admin445+34, web109, signed HTTP3, all workspace types and full admin/web production builds passed; counts overlap.44/97tasks(45%rounded),0/14gates;5more whole tasks needed for50%. No production identity, real contacts/provider, actual device/operator/rights/cutover pass. App/CI source stays local before1November; no hosted Actions or financial/credential/plan change.';
const task = tasks.find((t) => t.id === '08-5');
assert.equal(task.done, false);
task.done = true;
task.evidence +=
  '\n\nAccepted220 as completed local implementation/browser verification only. ' +
  summary +
  ' Feature d532848e2a49fb604d81c1a3edb0494af7be5da2; realtor-platform/docs/evidence/2026-10-29-company-settings.md. Contacts/domains/identity/modules remain deployment-controlled. One temporary owned browser connection-error tab could not acknowledge closure; listener/dev-lock teardown confirmed, viewport reset and user dashboard notes untouched. No release gate inferred.';
for (const id of ['08', '12'])
  plan.stages
    .find((s) => s.id === id)
    .notes.push({
      date: '29October2026',
      author: 'Codex',
      text:
        summary +
        ' Evidence:realtor-platform/docs/evidence/2026-10-29-company-settings.md. Native preview stopped; public stock/old live/vendor resources unchanged. Next: preserve/publish220 status, then verify original-resource manifest/read-only archives and remaining catalogue/native scope. Owner:Boniface+Codex.',
    });
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'approved-company-settings-2026-10-29-220';
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
    '# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint —29October2026 (220)\n\n' +
      summary +
      ' Evidence:realtor-platform/docs/evidence/2026-10-29-company-settings.md.',
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
await cp(
  new URL('docs/evidence/2026-10-29-company-settings/', root),
  new URL('dist/evidence/2026-10-29-company-settings/', dashboard),
  { recursive: true },
);
const html = new URL('dist/index.html', dashboard);
await writeFile(
  html,
  (await readFile(html, 'utf8')).replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">29 OCTOBER · APPROVED COMPANY SETTINGS</span><h2>Review the brand. Approve the copy. Keep the history.</h2><p>The connected editor now saves approved content with current company/admin permissions, version checks and original-result recovery. Approved copy and palette reach the anonymous public pages; missing contacts stay unavailable.</p><p>44 of97 tasks complete ·45% rounded. Five more whole tasks are needed to cross50%. Application source and CI stay local before November1; no hosted Actions run or release gate claimed.</p><a href="evidence/2026-10-29-company-settings.md">Read actual checks and limits →</a><br><a href="evidence/2026-10-29-company-settings/admin-desktop-top.jpg">View the verified editor →</a><br><a href="evidence/2026-10-29-company-settings/public-approved-desktop.jpg">View the approved public readback →</a><br><a href="ci-efficiency.md">Review the local CI conservation changes →</a></div><div class="checkpoint-metrics"><strong>357 SQL ·307 API passed</strong><span>Current authority, immutable history and original recovery</span><strong>445+34 admin ·109 web passed</strong><span>Real browser recovery, explicit reapproval and narrow layouts</span><strong>0 of14 release gates</strong><span>Provider, devices, operator, rights and cutover stay open</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL('docs/' + name, root);
  await writeFile(
    path,
    '## Latest checkpoint220 —29October2026\n\n' +
      summary +
      ' Evidence:[approved company settings](evidence/2026-10-29-company-settings.md). Feature d532848 stays local; ledger34executions/6fixed defects/35incomplete cases,0gates. Private219 dashboard206/sourceb245d82 succeeded under one owner/zero visitors/groups; source71c6674 complete same-device bundle/fresh clean restore/fsck/26execution check passed. Exact next: finish220 preservation/private status publication, then verify existing2254-file resource manifest and four read-only original ZIP archives; continue normalized catalogue/native scope toward49/97. All local previews stopped, dev locks absent and viewport reset. One owned temporary browser error tab4 remains unmarked after URL-guard cleanup failure; no stale-instance browser pass claimed. User dashboard notes unchanged. No GitHub app-source push/Actions before1November, purchases/credits/reset/plan/credential changes or old-live cutover. Owner:Boniface+Codex.\n\n' +
      (await readFile(path, 'utf8')),
  );
}
await writeFile(
  new URL('docs/ACTIVE-WORK.md', root),
  '# Active work —220 settings complete locally; continue toward50%\n\n' +
    summary +
    '\n\nFeature d532848 local. One-shot220 run; never replay219/220 scripts over later notes. Current evidence docs/evidence/2026-10-29-company-settings.md and folder. All owned local3120/3121 listeners/dev locks gone, launcher31144 exited0; viewport reset. Owned tabs2/3/5 closed, temporary owned connection-error tab4 closure blocked by browser URL guard; unmarked for automatic cleanup, user dashboard tab1 untouched. Extra stale-instance browser check not run, permissions supported by SQL/HTTP/BFF proof. Generated web next-env.d.ts unstaged.\n\nExact next: complete220 source backup/private publication preserving browser notes, then current hash verification of docs/preservation-manifest.json (2254 source files/four source roots) and four existing read-only archives at ../rebuild-preservation/2026-10-09. All four roots exist; archives are ReadOnly with matching original length, hashes not yet rechecked this session. Do not mark01-1 complete before actual hash/inventory reconciliation. Continue catalogue/native scope;5more whole tasks needed for50%. No app source push/hosted Actions before1November, purchases/reset/plan changes or vendor/live edits. Owner:Boniface+Codex.\n',
);
console.log(JSON.stringify({ done: 44, total: 97, notes: 699, gates: 0 }));
