/** Reproducible evidence index. --write updates generated records; default checks them. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const textHash = (value) => hash(value.toString('utf8').replaceAll('\r\n', '\n'));
const originalSource =
  'C:/Users/BONIFACE/Documents/ChatGPT/RealEstate/UAT-2026-10-09/UAT-REPORT.md';
const originalSnapshot = 'docs/source-evidence/UAT-REPORT-2026-10-09.md';
const originalBytes = await readFile(new URL(originalSnapshot, root));
assert.equal(
  hash(originalBytes),
  '15e11faaebb8ed8acf3eb86a8b196bf07528ed00884dda0b4dafd72fff4f0dd8',
  'Preserved authoritative report changed; inspect the source and correction history.',
);
const report = originalBytes.toString('utf8');
const section = report.split('## Confirmed findings requiring triage')[1]?.split('\n## ')[0];
assert.ok(section, 'Original findings section must exist.');
const findings = section
  .split('\n')
  .filter((line) => /^\| P[123] \|/.test(line))
  .map((line) =>
    line
      .split('|')
      .slice(1, 6)
      .map((cell) => cell.trim()),
  );
assert.equal(findings.length, 24, 'Never count the table header as a defect.');
assert.match(report, /260 registered checks/);
const catalogue = await read('docs/acceptance-catalogue.md');
const requirements = await read('docs/requirements-traceability.md');
const cases = [];
for (const line of catalogue.split('\n')) {
  if (!/^\| (?:R-|AC-)/.test(line)) continue;
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  const legacy = /^R-\d{3}/.exec(cells[0])?.[0] ?? null;
  const label = legacy ? cells[1] : cells[0];
  const id = /^AC-\d{3}/.exec(label)?.[0];
  assert.ok(id);
  cases.push({
    id,
    requirement: legacy,
    title: label.slice(7).trim(),
    arrange: legacy ? cells[2] : null,
    expected: legacy ? cells[3] : cells[1],
  });
}
assert.deepEqual(
  cases.map((item) => item.id),
  Array.from({ length: 35 }, (_, index) => `AC-${String(index + 1).padStart(3, '0')}`),
);
for (let index = 1; index <= 25; index++)
  assert.match(requirements, new RegExp(`\\| R-${String(index).padStart(3, '0')} \\|`));

const commits = {
  search210: '45c9621b6669c7ed8cd6a062ca6f16f389db3806',
  mobile211: '9aedc88558b9168173697716adb804ceef877be6',
  foundation212: '86cf7ed329d804197de8c891f5647cde48f03406',
};
for (const commit of Object.values(commits))
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    cwd: root,
    stdio: 'pipe',
  });
const definitions = {
  api212: {
    path: 'docs/evidence/2026-10-28-operations-overview/api-full.txt',
    counts: [297],
    commit: commits.foundation212,
    environment: 'Windows / Node24 / restricted PGlite and API boundary tests; synthetic actors',
  },
  sdk212: {
    path: 'docs/evidence/2026-10-28-operations-overview/sdk-full.txt',
    counts: [300],
    commit: commits.foundation212,
    environment: 'Windows / Node24 / client transport and validation tests; synthetic actors',
  },
  domain212: {
    path: 'docs/evidence/2026-10-28-operations-overview/domain-full.txt',
    counts: [296],
    commit: commits.foundation212,
    environment: 'Windows / Node24 / pure domain contract tests',
  },
  admin212: {
    path: 'docs/evidence/2026-10-28-operations-overview/admin-tests-fixed.txt',
    counts: [437, 30],
    commit: commits.foundation212,
    environment: 'Windows / Node24 / compiled Next server boundaries and SSR UI checks',
  },
  signed212: {
    path: 'docs/evidence/2026-10-28-operations-overview/signed-http-full.txt',
    counts: [89],
    commit: commits.foundation212,
    environment:
      'Windows / Node24 / actual loopback HTTP, ephemeral signed identities and restricted PGlite; two synthetic companies',
  },
  media213: {
    path: 'docs/evidence/2026-10-28-upload-acceptance/media-full.txt',
    counts: [194],
    commit: commits.foundation212,
    environment:
      'Windows / Node24 / actual supervised native codec and restricted PGlite plus contract doubles; synthetic bytes only',
  },
  search210: {
    path: 'docs/evidence/2026-10-28-search-and-enquiry-acceptance.md',
    counts: null,
    commit: commits.search210,
    environment:
      'Windows / in-app browser / current local synthetic Next web and admin journeys, keyboard and narrow viewport; no physical devices',
  },
  mobile211: {
    path: 'docs/evidence/2026-10-28-mobile-offline.md',
    counts: null,
    commit: commits.mobile211,
    environment:
      'Windows / mobile controller tests and Android Hermes export; no installed device test',
  },
  operations212: {
    path: 'docs/evidence/2026-10-28-operations-overview.md',
    counts: null,
    commit: commits.foundation212,
    environment:
      'Windows / in-app browser / current admin overview actions, narrow keyboard layout and foreign-record denial',
  },
  backup212: {
    path: 'docs/evidence/2026-10-28-operations-overview/publication.json',
    counts: null,
    commit: commits.foundation212,
    environment:
      'Windows / complete source-history bundle / fresh clean clone and fsck; same device only, no production data restore',
  },
};
const executions = {};
for (const [id, definition] of Object.entries(definitions)) {
  const bytes = await readFile(new URL(definition.path, root));
  const raw = bytes.toString('utf8');
  if (definition.counts) {
    const actual = [...raw.matchAll(/(?:ℹ|#) pass (\d+)/g)].map((match) => Number(match[1]));
    assert.deepEqual(actual, definition.counts, `Unexpected passed counts in ${id}`);
    for (const [kind, value] of [
      ...raw.matchAll(/(?:ℹ|#) (fail|cancelled|skipped|todo) (\d+)/g),
    ].map((match) => [match[1], Number(match[2])]))
      assert.equal(value, 0, `${id} has ${kind}`);
  }
  executions[id] = {
    ...definition,
    sha256: textHash(bytes),
    hashScope: 'UTF-8 text with CRLF normalized to LF; raw log contents otherwise retained',
    observedDate: '2026-10-28',
    coverage:
      'Limited to the named tests and environment. Not a complete acceptance-case or release-gate pass.',
  };
}
// Each entry is a reviewed scope statement, not a pass inferred from a suite total.
const reviewed = [
  [
    1,
    'reserved',
    [],
    'Header artefact reconciled to 24 substantive original findings; stable R IDs preserved.',
    'No product defect or product test pass is attached to the reserved header ID.',
    'Retain the correction and validate the original report when changing mappings.',
  ],
  [
    2,
    'partial',
    ['api212', 'signed212', 'admin212'],
    'Current signed customer, revoked and foreign actor denials; server-owned staff access and guarded listing commands.',
    'Production identity, native route bypass and deployed storage permissions still require verification.',
    'Complete the real identity/browser/native denial matrix on the release candidate.',
  ],
  [
    3,
    'partial',
    ['api212', 'signed212', 'sdk212', 'media213'],
    'Current company/assignment checks, exact operation recovery and raw viewing-table denial.',
    'Exports, subscriptions and full production pooled/storage isolation are not accepted.',
    'Implement and test scoped export/session/job paths, then rerun the complete two-company matrix.',
  ],
  [
    4,
    'partial',
    ['operations212', 'api212'],
    'A current foreign enquiry read hides loaded private details; current membership revocation is denied at SQL/API.',
    'Sign-out broadcast, two-tab private cache clearing, native expiry and subscription teardown are unimplemented or unverified.',
    'Implement provider-backed logout/expiry and verify two tabs plus native storage.',
  ],
  [
    5,
    'partial',
    ['media213', 'api212', 'sdk212', 'admin212'],
    'Blocked-body cancellation/deadlines, interrupted socket propagation, single-attempt processing and lost-result reconciliation are tested.',
    'Expired/incomplete batch retention cleanup and the complete interrupted multi-file browser/device journey remain open.',
    'Implement auditable retention/cleanup without deleting referenced outputs; verify interrupted file3/4 and original-operation recovery.',
  ],
  [
    6,
    'not_run',
    [],
    'No replacement production password UI has been accepted.',
    'Provider login/reset/reveal UI and keyboard/screen-reader checks remain open.',
    'Choose the controlled identity integration and test only dummy passwords.',
  ],
  [
    7,
    'partial',
    ['search210', 'operations212', 'mobile211', 'signed212'],
    'Current web/admin routes and builds run; local API errors fail safely; mobile controller fallback and Android export pass.',
    'Cold native/deep-link/chunk-failure recovery across actual devices and a second browser remains unverified.',
    'Run the complete boot/deep-link/recovery matrix on the release applications.',
  ],
  [
    8,
    'partial',
    ['domain212', 'api212', 'sdk212', 'admin212'],
    'Positive exact minor-unit, purpose/period and client/server validation have executed coverage.',
    'The full normalized import and every create/edit/UI/direct-bypass combination has not been accepted.',
    'Complete ordinary normalized catalogue/import then execute every boundary entry point.',
  ],
  [
    9,
    'partial',
    ['search210', 'api212', 'sdk212'],
    'Actual browser and SQL/API strict Over, inclusive endpoints and one-cent rental/sale neighbours verified.',
    'Native UI/device and final deployed catalogue range acceptance remain open.',
    'Repeat the same boundary triplets on native devices and release deployment.',
  ],
  [
    10,
    'partial',
    ['search210', 'mobile211'],
    'Actual web filters/pages/detail-back/refresh/reset preserved; mobile saved-filter and race handling tests passed.',
    'Actual native force-quit/relaunch, company switch and device back behavior remain unverified.',
    'Run persisted native filter restart/clear/back checks on an available device.',
  ],
  [
    11,
    'partial',
    ['search210', 'operations212', 'domain212'],
    'Exact web/admin KES and period presentation observed; domain money rules tested.',
    'Favourites and actual mobile exact-price presentation are incomplete or unverified.',
    'Build favourites and verify the neighbouring prices in every listed surface.',
  ],
  [
    12,
    'partial',
    ['domain212', 'api212', 'sdk212', 'admin212', 'operations212'],
    'Exact fee/period/quote-required contract and rendered submitted review costs are verified locally.',
    'Public/native full fee disclosure and normalized authoring/import acceptance remain open.',
    'Verify base, named recurring fees, deposits and unknown quotes end to end across applications.',
  ],
  [
    13,
    'partial',
    ['domain212', 'api212', 'signed212', 'search210'],
    'Canonical types/purpose and synthetic public/ordinary staff data are validated.',
    'Ordinary normalized location/catalogue promotion and import unknown-type handling are not fully accepted.',
    'Complete normalized catalogue/default-path authoring and all-type import/display scenarios.',
  ],
  [
    14,
    'partial',
    ['search210', 'api212', 'domain212'],
    'Actual exact7/8/9/10 and7+ search, studio0 and distinct private/shared bathroom results verified.',
    'Native device controls and all create/edit/import routes still need the complete matrix.',
    'Verify retained numeric room data through normalized authoring/import and native journeys.',
  ],
  [
    15,
    'partial',
    ['domain212', 'sdk212'],
    'Shared validation/normalization contracts have executed test coverage.',
    'Real business contact ownership and actual call/WhatsApp handoff across devices are unverified.',
    'Verify the approved company destination and device handoff without sending unsolicited messages.',
  ],
  [
    16,
    'partial',
    ['api212', 'admin212', 'signed212', 'operations212'],
    'Guarded review/version rules and an actual deliberate rejection/readback/queue refresh observed.',
    'Full deployed image-backed operator decision matrix and real pooled races remain open.',
    'Repeat approved-snapshot/edit/rejection/pause/conflict journeys with verified image bytes in staging.',
  ],
  [
    17,
    'partial',
    ['api212', 'signed212', 'admin212', 'operations212'],
    'Local request/proposal/confirmation/terminal cycles and synthetic reminder boundaries are covered; actual outcome action verified.',
    'Calendar presentation, outbound provider/consent/failure retry visibility and native/operator acceptance remain open.',
    'Build the calendar and selected notification adapter; verify failed/delayed/suppressed delivery with an approved test destination.',
  ],
  [
    18,
    'partial',
    ['domain212', 'api212', 'admin212', 'media213'],
    'Photo contract and guarded attachment/submission boundaries execute in the current suites.',
    'Current complete UI0/3/4/12/13 matrix with image-backed galleries has not been reaccepted.',
    'Run the complete photo-count cases through actual upload, gallery ordering and submission controls.',
  ],
  [
    19,
    'partial',
    ['media213', 'api212', 'sdk212', 'admin212'],
    'Actual JPEG/progressive JPEG/PNG/static WebP, metadata stripping, corrupt decode, dimension/byte caps and unsafe containers tested.',
    'Complete per-file browser errors, production object access and device interruption matrix remain open.',
    'Verify invalid selections and corrupt/oversized bytes in the actual editor and deployed object boundary.',
  ],
  [
    20,
    'not_run',
    [],
    'Guest enquiry validation is a separate implemented feature and is not signed-in feedback acceptance.',
    'Signed-in feedback author binding, blank refusal and counter behavior remain unimplemented or unverified.',
    'Implement scoped feedback if retained in launch scope and execute the separate acceptance case.',
  ],
  [
    21,
    'not_run',
    [],
    'No claim of verified call/WhatsApp ownership or an implemented fake-listing report/triage loop.',
    'Business contact handoff, durable report receipt and admin resolution remain open.',
    'Build and test a private rate-limited report/triage loop plus approved contact destinations.',
  ],
  [
    22,
    'deferred',
    [],
    'Payments, transaction booking and commission ledgers are intentionally outside the recorded pilot scope.',
    'No ledger/payment/commission functionality or nonzero transaction test is claimed.',
    'Retain truthful unavailable navigation and future acceptance criteria; obtain explicit scope change before implementing money flows.',
  ],
  [
    23,
    'partial',
    ['operations212', 'admin212'],
    'Operations empty/populated queues, current authorized actions and generic denial/unavailable states are implemented and locally observed.',
    'Report/support queue and complete unavailable-module navigation audit remain open.',
    'Build retained support/report workflows and verify their empty/loading/error/disabled states.',
  ],
  [
    24,
    'partial',
    ['search210', 'operations212', 'admin212', 'mobile211'],
    'Specific keyboard focus, narrow browser layout and labelled SSR/native component checks executed.',
    'No complete WCAG2.2AA, assistive-technology, 320px/200% text or Android/iOS process audit has passed.',
    'Run and remediate the complete accessibility/browser/device matrix.',
  ],
  [
    25,
    'not_run',
    [],
    'Company policy approval is not inferred from a configured text or notice-version field.',
    'Reviewed finished company-specific policies, contacts and accountable reviewer remain open.',
    'Obtain approved policy content and verify every page/link/form notice version.',
  ],
  [
    26,
    'partial',
    ['api212', 'sdk212', 'signed212', 'admin212'],
    'Guest/staff enquiry validation, idempotency/recovery, denial and rate-control suites pass locally.',
    'Production distributed abuse control and hosted durable delivery/operator acceptance remain open.',
    'Verify the configured distributed rate provider and persistent staging enquiry receipt under lost responses.',
  ],
  [
    27,
    'partial',
    ['search210', 'api212', 'signed212', 'admin212'],
    'Actual assignment, contact, follow-up reschedule/closure and role-limited queue journeys verified.',
    'Production identity/persistence, operator review and native journeys remain open.',
    'Repeat assignment/history/closure on the release candidate with a Realtime operator.',
  ],
  [
    28,
    'partial',
    ['signed212', 'mobile211'],
    'Two synthetic company contexts and shared configuration are exercised; no code fork required.',
    'Full web/mobile/admin identity/contact/storage/cache/notification second-brand acceptance remains open.',
    'Run the entire configured second-brand flow including notifications and device storage separation.',
  ],
  [
    29,
    'partial',
    ['domain212', 'api212', 'signed212', 'operations212'],
    'Availability guards and new720-hour stale queue selection distinguish fresh/paused/foreign stock in restricted SQL.',
    'The complete21/30-day prompt/public exclusion/reconfirmation matrix on deployed applications remains open.',
    'Verify exact cutoff neighbours and restoration/pause/archive precedence in current UI and staging.',
  ],
  [
    30,
    'partial',
    ['api212', 'sdk212', 'media213'],
    'Private/public projection and current role restrictions have bounded executed evidence.',
    'Audited export, retention dry-run/holds, deletion and restore re-deletion are incomplete.',
    'Implement scoped lifecycle/export controls and execute reviewed dry-run plus restore re-deletion.',
  ],
  [
    31,
    'not_run',
    [],
    'A read-only synthetic import preview does not establish a staged migration.',
    'Authorized source export, durable idempotent import, checksum/count reconciliation and rollback remain open.',
    'Resolve source rights/account access and perform an isolated approved staging rehearsal.',
  ],
  [
    32,
    'partial',
    ['backup212'],
    'Same-device source bundle, fresh clean clone and fsck passed for checkpoint212; source history only.',
    'Independent database/media/config restore, agreed recovery targets and recovery timing remain open.',
    'Create an approved independent backup and restore the complete staged platform into isolation.',
  ],
  [
    33,
    'not_run',
    [],
    'KES10,000 remains a planning/client price baseline, not measured cost or profit.',
    'Per-company metering,70/85/100% alerting and throttles remain unimplemented or unverified.',
    'Implement measured usage and test budget alerts without purchasing services.',
  ],
  [
    34,
    'not_run',
    [],
    'No current cold/warm representative-inventory load or field performance result is claimed.',
    'Public/private lab profiling, slow-network budgets and eventual field traffic metrics remain open.',
    'Measure representative synthetic inventory in the selected deployment and record lab/field scope separately.',
  ],
  [
    35,
    'partial',
    ['api212', 'signed212', 'media213', 'admin212'],
    'Exact-version commands, once-only attempts, stale/refusal/uncertainty and immutable-history guards execute locally.',
    'True independent PostgreSQL connection races, crash recovery and production notification rollback remain open.',
    'Run independent pooled-session races and rollback/delivery integrity cases on approved staging.',
  ],
];
assert.equal(reviewed.length, 35);
const entries = cases.map((item, index) => {
  const [number, status, evidence, observed, remaining, nextAction] = reviewed[index];
  assert.equal(number, index + 1);
  evidence.forEach((key) => assert.ok(executions[key], `Missing evidence ${key}`));
  const originalFinding =
    index > 0 && index < 25
      ? { priority: findings[index - 1][0], title: findings[index - 1][1], sourceRow: index }
      : null;
  return {
    ...item,
    originalFinding,
    status,
    releaseCasePassed: false,
    evidence,
    observed,
    remaining,
    nextAction,
    owner: 'Boniface + Codex',
    gapId: number === 1 ? null : `GAP-${item.id}`,
  };
});
const fixes = [
  {
    id: 'FIX-210-01',
    cases: ['AC-010', 'AC-024'],
    problem: 'Invalid GeoJSON disabled the interactive Clear area control.',
    status: 'retested_in_stated_environment',
    evidence: 'search210',
    remaining: 'Full device/assistive-technology acceptance remains open.',
  },
  {
    id: 'FIX-211-01',
    cases: ['AC-003', 'AC-009', 'AC-030'],
    problem:
      'Ordinary property assignment dropped or reinterpreted an own __proto__ query key before validation.',
    status: 'retested_in_stated_environment',
    evidence: 'sdk212',
    marker: 'both public searches reject an own __proto__ query key before any network request',
    remaining: 'No privilege compromise is asserted; production security matrix remains open.',
  },
  {
    id: 'FIX-212-01',
    cases: ['AC-002', 'AC-003'],
    problem: 'Initial overview implementation queried a viewing table denied to the runtime role.',
    status: 'retested_in_stated_environment',
    evidence: 'api212',
    before: 'docs/evidence/2026-10-28-operations-overview/initial-direct-read-denied.txt',
    remaining:
      'Fixed through a narrow SQL function; raw-table denial retained. No wider grants added.',
  },
  {
    id: 'FIX-212-02',
    cases: ['AC-007'],
    problem: 'New admin imports lacked extensions required by the test compiler.',
    status: 'retested_in_stated_environment',
    evidence: 'admin212',
    before: 'docs/evidence/2026-10-28-operations-overview/admin-tests.txt',
    remaining: 'Full native/startup/device acceptance remains open.',
  },
];
for (const fix of fixes) {
  if (fix.marker) assert.ok((await read(executions[fix.evidence].path)).includes(fix.marker));
  if (fix.before) fix.beforeSha256 = textHash(await readFile(new URL(fix.before, root)));
}
const data = {
  schemaVersion: 1,
  updatedAt: '2026-10-28',
  owner: 'Boniface + Codex',
  purpose: 'Execution traceability, not product or release acceptance',
  originalReport: {
    path: originalSource,
    snapshot: originalSnapshot,
    sha256: hash(originalBytes),
    substantiveFindings: 24,
    reservedHeader: 'R-001',
    registeredLegacyChecks: 260,
    legacyResultsAreReplacementPasses: false,
  },
  catalogue: {
    path: 'docs/acceptance-catalogue.md',
    sha256: textHash(catalogue),
    hashScope: 'UTF-8 text with CRLF normalized to LF',
    caseCount: 35,
  },
  executions,
  cases: entries,
  fixes,
  acceptedReleaseGates: 0,
  limits:
    'Suite totals overlap. Case states and remaining gaps govern interpretation; no complete product acceptance case or launch gate is inferred from this index.',
};
const md = [
  '# Replacement acceptance status and defect/retest index',
  '',
  `Updated ${data.updatedAt}. All 24 substantive vendor findings plus reserved R-001 and all 35 replacement acceptance cases are linked below. This is maintained traceability, **not release acceptance**. No legacy PASS is imported as a replacement PASS.`,
  '',
  'Case states deliberately distinguish partial evidence, not run, deferred and the reserved header. Every unresolved case has a named gap and next action. Test counts overlap and must not be added into a platform completion figure.',
  '',
  '## Execution records',
  '',
  '| ID | Evidence at source commit | Actual scope |',
  '| --- | --- | --- |',
  ...Object.entries(executions).map(
    ([id, e]) =>
      `| ${id} | [${e.path.replace('docs/', '')}](${e.path.replace('docs/', '')}) · ${e.commit.slice(0, 7)} | ${e.counts ? e.counts.join(' + ') + ' passed; ' : ''}${e.environment} |`,
  ),
  '',
  '## Requirements, cases and open gaps',
  '',
  ...entries.flatMap((entry) => [
    `### ${entry.id} — ${entry.title}`,
    '',
    `**${entry.requirement ?? 'Additional replacement gate'} · ${entry.status} · ${entry.gapId ?? 'reserved correction'}**`,
    entry.originalFinding ? `Original finding: ${entry.originalFinding.title}.` : '',
    `Expected: ${entry.expected}`,
    `Observed: ${entry.observed}`,
    `Evidence: ${entry.evidence.length ? entry.evidence.map((id) => `[${id}](${executions[id].path.replace('docs/', '')})`).join(', ') : 'No product execution pass attached.'}`,
    `Still open: ${entry.remaining}`,
    `Next: ${entry.nextAction} Owner: ${entry.owner}.`,
    '',
  ]),
  '## Fixed defects and bounded retests',
  '',
  ...fixes.flatMap((fix) => [
    `- **${fix.id}** (${fix.cases.join(', ')}): ${fix.problem} Retest: [${fix.evidence}](${executions[fix.evidence].path.replace('docs/', '')}); ${fix.status}. ${fix.before ? `[Initial failure](${fix.before.replace('docs/', '')}). ` : ''}${fix.remaining}`,
  ]),
  '',
  '## Maintenance',
  '',
  'Update the reviewed scope statements and source commits in `scripts/acceptance-status.mjs` only after inspecting executed results. Run `node scripts/acceptance-status.mjs --write`, then `node scripts/acceptance-status.mjs`. The check verifies exact original finding/case coverage, report hashes, declared pass counts, no skipped/failed cases in those named suites, source ancestry and retained failure/retest links. A suite pass never automatically closes an acceptance case or release gate. Preserve older raw evidence and state exactly what a new run changes.',
  '',
].join('\n');
const json = JSON.stringify(data, null, 2) + '\n';
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const evidenceLinks = (keys) =>
  keys
    .map((id) => `<a href="${escape(executions[id].path.replace('docs/', ''))}">${escape(id)}</a>`)
    .join(' · ');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Replacement acceptance evidence and remaining work</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ee;color:#252321;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:30px 24px}a{color:#5e0202}a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #286078;outline-offset:4px}h1{font-size:clamp(30px,5vw,50px);line-height:1.15;max-width:850px}h2{font-size:25px}header p{max-width:850px}.notice{padding:20px;background:#fff4dd;border-left:4px solid #8c5916}.metrics{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.metrics span{background:white;padding:14px 20px;border:1px solid #dcd6cc;border-radius:12px}.metrics strong{display:block;font-size:27px}.filters{display:flex;flex-wrap:wrap;gap:18px;background:white;padding:20px;border-radius:12px}.filters label{display:grid;gap:5px;flex:1;min-width:180px}input,select{font:inherit;min-height:48px;width:100%;padding:8px;border:1px solid #8c8278;border-radius:6px}article{border:1px solid #dcd6cc;background:white;border-radius:12px;padding:22px;margin:16px 0;overflow-wrap:anywhere}article h3{font-size:20px;margin:0}article p{margin:12px 0}.state{display:inline-block;border:1px solid #8c8278;border-radius:30px;padding:2px 12px;margin:10px 0;font-size:14px}details{border-top:1px solid #ddd6cc;padding-top:12px}summary{cursor:pointer;min-height:44px;display:list-item;color:#5e0202;font-weight:600}small{display:block;color:#61594f}code{font-size:14px}footer{margin:40px 0} [hidden]{display:none!important}@media(max-width:500px){main{padding:20px 16px}.filters{display:block}.filters label+label{margin-top:16px}article{padding:18px}.metrics span{flex:1;min-width:120px}}
</style><main><header><a href="index.html">← Delivery checklist</a><p>INDEPENDENT REBUILD / ACCEPTANCE EVIDENCE / 28 OCTOBER 2026</p><h1>What was checked. What still needs work.</h1><p>Each original finding now leads to a replacement case, bounded execution evidence and an explicit next action. Old vendor results are historical evidence.</p><p class="notice"><strong>No release acceptance is implied.</strong> Partial checks, not-run cases and deferred modules stay explicit. Suite totals overlap. Actual devices, provider/account facts, operator UAT and cutover gates remain open.</p></header><div class="metrics"><span><strong>24</strong>original findings</span><span><strong>35</strong>replacement cases linked</span><span><strong>4</strong>bounded defect retests</span><span><strong>0 / 14</strong>accepted release gates</span></div><section aria-labelledby="case-title"><h2 id="case-title">Cases and next actions</h2><div class="filters"><label for="case-search">Find a case, requirement or gap<input id="case-search" type="search" placeholder="For example: upload or AC-005"></label><label for="case-state">Evidence state<select id="case-state"><option value="all">All cases</option><option value="partial">Partial evidence</option><option value="not_run">Not run</option><option value="deferred">Deferred</option><option value="reserved">Reserved correction</option></select></label></div><p id="case-count" role="status">35 cases shown</p><div id="case-list">${entries.map((entry) => `<article data-state="${entry.status}" id="${entry.id}"><h3>${entry.id} · ${escape(entry.title)}</h3><small>${escape(entry.requirement ?? 'Additional replacement gate')} · ${escape(entry.gapId ?? 'Reserved header correction')}</small><span class="state">${escape(entry.status.replaceAll('_', ' '))}</span><p><strong>Observed:</strong> ${escape(entry.observed)}</p><p><strong>Still open:</strong> ${escape(entry.remaining)}</p><p><strong>Next:</strong> ${escape(entry.nextAction)}</p><small>Owner: ${escape(entry.owner)}</small><details><summary>Expected result and evidence</summary>${entry.originalFinding ? `<p>Original finding: ${escape(entry.originalFinding.title)}</p>` : ''}<p>${escape(entry.expected)}</p><p>${entry.evidence.length ? evidenceLinks(entry.evidence) : 'No product execution pass attached.'}</p><p>No complete release-case pass recorded.</p></details></article>`).join('')}</div><p id="case-empty" hidden>No cases match. Clear the search or choose all cases.</p></section><section aria-labelledby="fix-title"><h2 id="fix-title">Fixed defects and bounded retests</h2>${fixes.map((fix) => `<article><h3>${fix.id}</h3><p>${escape(fix.problem)}</p><p>${escape(fix.cases.join(', '))} · ${evidenceLinks([fix.evidence])}</p><p>${escape(fix.remaining)}</p></article>`).join('')}</section><footer><a href="acceptance-status.json" download>Download structured case ledger</a> · <a href="acceptance-status.md" download>Download detailed notes</a><p>Source report preserved byte-for-byte. Other text evidence hashes normalize CRLF to LF for portable checks. Run <code>node scripts/acceptance-status.mjs</code> in the canonical repository to verify the index. Maintenance does not close product defects automatically.</p></footer></main><script>
const search=document.querySelector('#case-search'),state=document.querySelector('#case-state'),rows=[...document.querySelectorAll('#case-list article')];function filter(){const query=search.value.trim().toLocaleLowerCase();let count=0;for(const row of rows){row.hidden=(state.value!=='all'&&row.dataset.state!==state.value)||(query&&!row.textContent.toLocaleLowerCase().includes(query));if(!row.hidden)count++;}document.querySelector('#case-count').textContent=count+' cases shown';document.querySelector('#case-empty').hidden=count!==0;}search.addEventListener('input',filter);state.addEventListener('change',filter);
</script></html>\n`;
if (process.argv.slice(2).length > 1 || (process.argv[2] && process.argv[2] !== '--write'))
  throw Error('Use no arguments to check or --write to generate.');
if (process.argv[2] === '--write') {
  await writeFile(new URL('docs/acceptance-status.json', root), json);
  await writeFile(new URL('docs/acceptance-status.md', root), md);
  await writeFile(new URL('docs/acceptance-status.html', root), html);
} else {
  assert.equal(await read('docs/acceptance-status.json'), json, 'Generated JSON is stale.');
  assert.equal(await read('docs/acceptance-status.md'), md, 'Generated Markdown is stale.');
  assert.equal(await read('docs/acceptance-status.html'), html, 'Generated HTML is stale.');
}
console.log(
  JSON.stringify({
    mode: process.argv[2] === '--write' ? 'write' : 'check',
    originalFindings: 24,
    reserved: 1,
    cases: 35,
    executions: Object.keys(executions).length,
    fixedDefects: fixes.length,
    completeReleaseCases: 0,
    acceptedReleaseGates: 0,
  }),
);
