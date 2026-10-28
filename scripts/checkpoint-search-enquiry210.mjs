/** One-shot evidence-backed tracker checkpoint. Refuses another baseline or a second run. */
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dashboard = new URL('../../realtor-delivery-dashboard/', import.meta.url);
const planPath = new URL('dist/plan.json', dashboard);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
assert.match(plan.baseline, /^Checkpoint209 /);
const tasks = plan.stages.flatMap((stage) => stage.tasks);
assert.equal(tasks.length, 97);
assert.equal(tasks.filter((task) => task.done).length, 33);
assert.equal(
  plan.stages.reduce((count, stage) => count + stage.notes.length, 0),
  677,
);
const evidence = 'realtor-platform/docs/evidence/2026-10-28-search-and-enquiry-acceptance.md';
const result =
  'Checkpoint210 (28 October 2026): accepted complete search filters/counts/sort/pages/URL state (07-2) and enquiry pipeline/assignment/contact/follow-up/reminders (08-2) after current synthetic browser, keyboard and narrow-layout verification. Fixed interactive Clear area for invalid GeoJSON; local test grid sends no external tile requests. Web101/101, TypeScript and full production build passed; admin437 logic/boundary +28 UI tests passed. 35/97 tasks (36% rounded), 0/14 gates. Fourteen more whole tasks needed to cross50%; operator UAT, actual devices, provider/hosting/rights/cutover remain open.';
for (const id of ['07-2', '08-2']) {
  const task = tasks.find((task) => task.id === id);
  assert.equal(task.done, false);
  task.done = true;
  task.evidence += `\n\nAccepted checkpoint210, 28 October 2026: ${id === '07-2' ? 'Current browser verified32 synthetic listings over12/12/8 pages, inclusive/strict-cent rent and sale ranges, exact7–10 and7+ bedrooms/studios, bath distinctions, saved location/amenity conjunctions, type/text filters, price/title sort, detail/back/refresh/reset and polygon draw/undo/cancel/clear/URL. Invalid text Clear regression fixed and observed. Web101/101, TypeScript/full production build passed.' : 'Current admin/agent browser verified50+10 and50+4 pages after assignment, older overdue discovery, contact receipt/feed, versioned reschedule/read/adopt, overdue→today movement, closure/reminder removal, explicit dirty-input discard and assignment/private role separation. Narrow390px browser and keyboard checks observed; admin437+28 tests passed.'} ${evidence}. Operator UAT and actual device/production/provider/release acceptance remain separate and unclaimed.`;
}
for (const id of ['07', '08']) {
  const stage = plan.stages.find((stage) => stage.id === id);
  stage.notes.push({
    date: '28 October 2026',
    author: 'Codex',
    text: `${result} Evidence: ${evidence}. Next: publish owner-private dashboard preserving browser notes; continue native search and dependency-ready implementation. Owner: Boniface + Codex.`,
  });
}
plan.updatedAt = new Date().toISOString();
plan.baselineRevision = 'search-enquiry-browser-2026-10-28-210';
plan.baseline = result;
assert.equal(tasks.filter((task) => task.done).length, 35);
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
await writeFile(
  new URL('dist/plan-data.js', dashboard),
  `window.REALTOR_PLAN=${JSON.stringify(plan)};\n`,
);
const planDoc = new URL('DELIVERY-PLAN.md', dashboard);
const previousPlanDoc = await readFile(planDoc, 'utf8');
await writeFile(
  planDoc,
  previousPlanDoc.replace(
    '# Realtor Platform Rebuild — Delivery Plan',
    `# Realtor Platform Rebuild — Delivery Plan\n\n## Latest checkpoint — 28 October 2026 (210)\n\n${result} Evidence: ${evidence}.`,
  ),
);
await copyFile(planDoc, new URL('dist/DELIVERY-PLAN.md', dashboard));
await copyFile(
  new URL('../docs/evidence/2026-10-28-search-and-enquiry-acceptance.md', import.meta.url),
  new URL('dist/SEARCH-ENQUIRY-ACCEPTANCE210.md', dashboard),
);
const htmlPath = new URL('dist/index.html', dashboard);
const html = await readFile(htmlPath, 'utf8');
assert.match(html, /<section class="checkpoint"/);
await writeFile(
  htmlPath,
  html.replace(
    /<section class="checkpoint"[\s\S]*?<\/section>/,
    '<section class="checkpoint" aria-label="Latest verified checkpoint"><div><span class="eyebrow">28 OCTOBER · VERIFIED SEARCH AND DAILY WORK</span><h2>Search and follow-ups now have browser evidence.</h2><p>Exact prices and room counts, filters, sorting and pages were checked in the working website. Staff assignment, contact records and overdue-to-today follow-ups were checked in the admin and agent workspaces.</p><p>35 of 97 tasks complete · 36% rounded. Your 50% target needs 14 more whole tasks. Production and release gates remain open.</p><a href="SEARCH-ENQUIRY-ACCEPTANCE210.md">Read checkpoint evidence →</a></div><div class="checkpoint-metrics"><strong>101 web checks</strong><span>+ full production build</span><strong>437 + 28 admin checks</strong><span>+ actual synthetic browser journeys</span><strong>0 of 14 release gates</strong><span>No device, operator UAT or cutover pass claimed</span></div></section>',
  ),
);
for (const name of ['CONTINUATION.md', 'START-HERE.md']) {
  const path = new URL(`../docs/${name}`, import.meta.url);
  await writeFile(
    path,
    `## Latest checkpoint 210 — 28 October 2026\n\n${result} Evidence: [search and enquiry acceptance](evidence/2026-10-28-search-and-enquiry-acceptance.md). Owned previews3104/3114 and their tabs closed; generated next-env files preserved unstaged. Source remains local while Actions quota is exhausted. Exact next: publish existing owner-private dashboard with preserved browser notes, then continue native search integration/device readiness and other dependency-ready implementation; no forced50% or gate inflation.\n\n${await readFile(path, 'utf8')}`,
  );
}
console.log(JSON.stringify({ done: 35, total: 97, notes: 679, acceptedGates: 0 }));
