import { readFile, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
assert.equal(plan.baselineRevision, 'search-enquiry-browser-2026-10-28-210');
assert.equal(plan.stages.flatMap((stage) => stage.tasks).filter((task) => task.done).length, 35);
assert.equal(
  plan.stages.reduce((count, stage) => count + stage.notes.length, 0),
  679,
);
const summary =
  'Checkpoint211 (28 October 2026): mobile now offers explicit in-session previous-public-response fallback for the same query after refresh failure, with timestamp, warning, cancel/retry/clear and no disk catalogue cache. New negative testing exposed and fixed dropped __proto__ query fields in the shared client. Full client297/297 and mobile24/24, TypeScript and Android Hermes export631 modules passed after correcting a Metro import-resolution failure. No attached Android device; native interaction remains unverified. No new whole checklist item closes:35/97 (36% rounded),0/14 gates;50% needs14 more whole tasks.';
const evidence = 'realtor-platform/docs/evidence/2026-10-28-mobile-offline.md';
for (const id of ['05', '09'])
  plan.stages
    .find((stage) => stage.id === id)
    .notes.push({
      date: '28 October 2026',
      author: 'Codex',
      text: `${summary} Evidence: ${evidence}. Next: native device checks when available; continue connected admin operations and media implementation meanwhile. Owner:Boniface+Codex.`,
    });
for (const id of ['09-2', '09-5']) {
  const task = plan.stages.flatMap((stage) => stage.tasks).find((task) => task.id === id);
  assert.equal(task.done, false);
  task.evidence += `\n\nPartial checkpoint211: ${summary} ${evidence}. Complete native/device acceptance still open.`;
}
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'mobile-offline-2026-10-28-211';
plan.baseline = summary;
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
    `# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint — 28 October 2026 (211)\n\n${summary} Evidence: ${evidence}.`,
  ),
);
await copyFile(planDoc, new URL('dist/DELIVERY-PLAN.md', dashboard));
await copyFile(
  new URL('../docs/evidence/2026-10-28-mobile-offline.md', import.meta.url),
  new URL('dist/MOBILE-OFFLINE211.md', dashboard),
);
for (const name of ['mobile-tests.txt', 'sdk-tests.txt', 'android-export.txt'])
  await copyFile(
    new URL(`../docs/evidence/2026-10-28-mobile-offline/${name}`, import.meta.url),
    new URL(`dist/mobile-offline211-${name}`, dashboard),
  );
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL(`../docs/${name}`, import.meta.url);
  await writeFile(
    path,
    `## Latest checkpoint 211 — 28 October 2026\n\n${summary} Evidence: [mobile failure handling](evidence/2026-10-28-mobile-offline.md). Checkpoint210 owner-private dashboard version197/source7b0f044 succeeded and authenticated browser refresh showed36%/35 of97. Browser notes/checklist edits were retained without import; export/screenshot could not be confirmed, saved DOM only. No emulator or device launched at~1.2GiB physical free; ADB reported none. Exact next: publish211 to the same private audience, back up local source, then implement connected actionable admin operations summary for stale stock/pending reviews/overdue leads/viewing outcomes, with RLS/role tests and real browser evidence. This next feature has not been implemented or counted. Continue toward50% without gate inflation.\n\n${await readFile(path, 'utf8')}`,
  );
}
console.log(JSON.stringify({ done: 35, total: 97, notes: 681, acceptedGates: 0 }));
