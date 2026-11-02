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
  calendar214: '842f4931e91061c5279819fa215ddf66267e32a3',
  media215: '0595a6f129950fb29ee4eba2a07389346c61a075',
  media216: '1a2e18e714f2593284fe9511e39feed375263ff7',
  gallery217: '0951abc2ce40f0390b16c7c856e46addc628ed45',
  design218: '8d3fa7fa9de2d3073ea20016bf474dab0b6225c7',
  ci219: '84067fe074cad6b8df39108a57454753361b6c70',
  settings220: 'd532848e2a49fb604d81c1a3edb0494af7be5da2',
  settingsInitial: 'c17256f765d29ef063e267c2095ce9b5f368f7a3',
  preservation221: '895a95587932789f7249df2f741442b83695fd20',
  invitations225: '3d67007ef2a43f78bda17642f93b4b9d4c94b2b5',
  invitations224: 'dfe694b78919e98d168133892ff11daee2ebeebf',
  reports223: '6b8569b1c49f101062c0cfa9a0c7c054d5f2d637',
  performance222: 'aa414973efd01198e865a0cb29ec6c7edc96f7f3',
};
for (const commit of Object.values(commits))
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    cwd: root,
    stdio: 'pipe',
  });
const definitions = {
  staffDirectoryDomain251: {
    path: 'docs/evidence/staff-directory251-domain-full.txt',
    counts: [336],
    commit: '85a168953218776ec204ac691d66acf61962fd83',
    observedDate: '2026-11-02',
    environment:
      'Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof.',
  },
  staffDirectorySql251: {
    path: 'docs/evidence/staff-directory251-sql.txt',
    counts: [7],
    commit: '85a168953218776ec204ac691d66acf61962fd83',
    observedDate: '2026-11-02',
    environment:
      'Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof.',
  },
  staffDirectoryApi251: {
    path: 'docs/evidence/staff-directory251-api.txt',
    counts: [9],
    commit: '85a168953218776ec204ac691d66acf61962fd83',
    observedDate: '2026-11-02',
    environment:
      'Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof.',
  },
  staffDirectorySdk251: {
    path: 'docs/evidence/staff-directory251-sdk-full.txt',
    counts: [326],
    commit: '85a168953218776ec204ac691d66acf61962fd83',
    observedDate: '2026-11-02',
    environment:
      'Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof.',
  },
  staffDirectoryAdmin251: {
    path: 'docs/evidence/staff-directory251-admin-full.txt',
    counts: [487],
    commit: '85a168953218776ec204ac691d66acf61962fd83',
    observedDate: '2026-11-02',
    environment:
      'Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof.',
  },
  staffDirectoryUi251: {
    path: 'docs/evidence/staff-directory251-ui-full.txt',
    counts: [38],
    commit: '85a168953218776ec204ac691d66acf61962fd83',
    observedDate: '2026-11-02',
    environment:
      'Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof.',
  },
  staffDirectorySigned251: {
    path: 'docs/evidence/staff-directory251-integration-verified.txt',
    counts: [8],
    commit: '85a168953218776ec204ac691d66acf61962fd83',
    observedDate: '2026-11-02',
    environment:
      'Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof.',
  },
  staffDomain248: {
    path: 'docs/evidence/staff-membership248-domain-full.txt',
    counts: [333],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment: 'Full domain regression including existing-staff administration contracts',
  },
  staffSql248: {
    path: 'docs/evidence/staff-membership248-sql-final.txt',
    counts: [5],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Restricted isolated SQL proposal with exact shared-contract outputs, current authorization, self/last-admin protection and immediate existing-resource denial; not hosted concurrency',
  },
  staffApi248: {
    path: 'docs/evidence/staff-membership248-api-full.txt',
    counts: [328],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Full API regression including default-off membership routes and actual restricted SQL rollback validation',
  },
  staffSdk248: {
    path: 'docs/evidence/staff-membership248-sdk-full.txt',
    counts: [323],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Full standard SDK regression including bounded membership writes/current/original and no automatic retry',
  },
  staffSigned248: {
    path: 'docs/evidence/staff-membership248-signed.txt',
    counts: [14],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Signed JWT/JWKS HTTP and restricted SQL membership/branch/invitation regression, including committed reply corruption and GET-only recovery',
  },
  staffAdmin248: {
    path: 'docs/evidence/staff-workspace248-admin-full.txt',
    counts: [475],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Full admin server/model/controller regression after Next metadata and invitation selection fixes',
  },
  staffUi248: {
    path: 'docs/evidence/staff-workspace248-ui-full.txt',
    counts: [36],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment: 'Full admin SSR/model UI checks; actual browser scope recorded separately',
  },
  staffBoundary248: {
    path: 'docs/evidence/staff-workspace248-focused.txt',
    counts: [9],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Next Node loopback metadata and unavailable branch selection regression; no production proxy authority',
  },
  staffPreview248: {
    path: 'docs/evidence/staff-preview248-lifecycle.txt',
    counts: [5],
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Owned child retirement and unconditional fixture shutdown using fakes; actual harness lifecycle separately observed',
  },
  staffBrowser248: {
    path: 'docs/evidence/2026-11-02-staff-management.md',
    counts: null,
    commit: '44e30ad89392f57fcbdcb6dd28429e64312b7d48',
    observedDate: '2026-11-02',
    environment:
      'Actual owned Next/in-app browser branch/capture/revocation corrupted-reply GET recovery, reload retention, unavailable selection and separate agent denial; no membership UI or recipient redemption',
  },
  invitationDomain225: {
    path: 'docs/evidence/staff-invitation-domain225.txt',
    counts: [317],
    commit: commits.invitations225,
    observedDate: '2026-10-30',
    environment:
      'Full domain regression including exact capture/state/revocation records and bounded parsing',
  },
  invitationApi225: {
    path: 'docs/evidence/staff-invitation-api225-full.txt',
    counts: [318],
    commit: commits.invitations225,
    observedDate: '2026-10-30',
    environment:
      'Full API regression after default-off non-production invitation routes; no provider or UI claim',
  },
  invitationSdk225: {
    path: 'docs/evidence/staff-invitation-sdk225-full.txt',
    counts: [311],
    commit: commits.invitations225,
    observedDate: '2026-10-30',
    environment:
      'Full SDK regression including explicit invitation methods and lost/malformed-write uncertainty',
  },
  invitationApiWire225: {
    path: 'docs/evidence/staff-invitation-api225-final.txt',
    counts: [6],
    commit: commits.invitations225,
    observedDate: '2026-10-30',
    environment:
      'Focused API boundaries plus actual SDK-to-service Request and restricted SQL; synthetic identity mapping, not signed HTTP',
  },
  invitationSqlWire225: {
    path: 'docs/evidence/staff-invitation-sql225-initial.txt',
    counts: [7],
    commit: commits.invitations225,
    observedDate: '2026-10-30',
    environment:
      'Isolated SQL candidate output bound to shared domain validators and C1 control refusal; first extended run passed',
  },
  staffWorkspaceUi246: {
    path: 'docs/evidence/staff-workspace246-ui-full.txt',
    counts: [36],
    commit: 'e87a61284404095def2e1785670e15beef609f2f',
    observedDate: '2026-10-31',
    environment:
      'Full admin SSR/model UI regression including staff workspace; not actual browser interaction',
  },
  staffWorkspaceWire246: {
    path: 'docs/evidence/staff-workspace246-integration.txt',
    counts: [5],
    commit: 'e87a61284404095def2e1785670e15beef609f2f',
    observedDate: '2026-10-31',
    environment:
      'Signed HTTP/restricted SQL BFF/browser adapter integration including fresh server loader session scope and agent/foreign refusal; no actual Next/browser HTTP claim',
  },
  staffController245: {
    path: 'docs/evidence/staff-controller245-full.txt',
    counts: [470],
    commit: '85d084e7834dfccdbc8c787451028c0adf99e7e3',
    observedDate: '2026-10-31',
    environment:
      'Full admin server/transport/model/controller regression; no mounted UI or actual browser proof',
  },
  staffBrowser243: {
    path: 'docs/evidence/staff-browser243-full.txt',
    counts: [460],
    commit: '543a68144f26e64fc166b6af8d4adf3b490ecc7f',
    observedDate: '2026-10-31',
    environment:
      'Full admin server/transport regression including current-instance staff browser client; no actual browser UI proof',
  },
  staffBrowserWire243: {
    path: 'docs/evidence/staff-browser243-integration.txt',
    counts: [5],
    commit: '543a68144f26e64fc166b6af8d4adf3b490ecc7f',
    observedDate: '2026-10-31',
    environment:
      'Browser adapter function to BFF functions and SDK over signed JWT/JWKS HTTP/restricted SQL; no actual browser or Next HTTP claim',
  },
  branchBff240: {
    path: 'docs/evidence/staff-branch-bff240-full.txt',
    counts: [454],
    commit: '2182f01a43232c0e7cb10fdfa67478db35e378ae',
    observedDate: '2026-10-31',
    environment:
      'Full admin server regression after current-instance branch BFF command and shared identity guard',
  },
  invitationBff241: {
    path: 'docs/evidence/staff-invitation-bff241-full.txt',
    counts: [456],
    commit: '2182f01a43232c0e7cb10fdfa67478db35e378ae',
    observedDate: '2026-10-31',
    environment:
      'Full admin server regression after invitation BFF and shared bounded command body parser',
  },
  staffBffHttp241: {
    path: 'docs/evidence/staff-invitation-bff241-integration.txt',
    counts: [4],
    commit: '2182f01a43232c0e7cb10fdfa67478db35e378ae',
    observedDate: '2026-10-31',
    environment:
      'BFF functions to SDK over signed JWT/JWKS HTTP and restricted SQL; branch/invitation committed corrupt replies recovered by GET only; no Next/browser HTTP proof',
  },
  directoryBff238: {
    path: 'docs/evidence/staff-directory-bff238-full.txt',
    counts: [452],
    commit: 'f8593efe1633b157ea7cc3eb77aab8226fafef50',
    observedDate: '2026-10-31',
    environment:
      'Full admin server regression including current-instance directory BFF; no UI/Next production build claim',
  },
  directoryBff239: {
    path: 'docs/evidence/staff-directory-bff239-integration.txt',
    counts: [2],
    commit: 'f8593efe1633b157ea7cc3eb77aab8226fafef50',
    observedDate: '2026-10-31',
    environment:
      'Actual directory BFF function to shared SDK over signed local JWT/JWKS HTTP and restricted SQL; synthetic actor/tenant denials, not browser/Next HTTP proof',
  },
  branchDomain234: {
    path: 'docs/evidence/staff-branch-domain234-full.txt',
    counts: [325],
    commit: '9f66380ba18fb5ce91b270bcf2efd1caf60cde83',
    observedDate: '2026-10-30',
    environment:
      'Full domain regression including exact branch command and original receipt contracts',
  },
  branchSql234: {
    path: 'docs/evidence/staff-branch-sql234-final.txt',
    counts: [3],
    commit: '9f66380ba18fb5ce91b270bcf2efd1caf60cde83',
    observedDate: '2026-10-30',
    environment:
      'Restricted isolated branch SQL outputs bound to original command and actor; no migration promotion',
  },
  branchApi235: {
    path: 'docs/evidence/staff-branch-api235-final.txt',
    counts: [9],
    commit: '9f66380ba18fb5ce91b270bcf2efd1caf60cde83',
    observedDate: '2026-10-30',
    environment:
      'Focused branch/directory/invitation API projection and original authority checks; not full API suite',
  },
  branchSdk236: {
    path: 'docs/evidence/staff-branch-sdk236-full.txt',
    counts: [317],
    commit: '9f66380ba18fb5ce91b270bcf2efd1caf60cde83',
    observedDate: '2026-10-30',
    environment:
      'Full standard SDK regression including exact branch save and GET original/current',
  },
  branchHttp236: {
    path: 'docs/evidence/staff-branch-http236-initial.txt',
    counts: [3],
    commit: '9f66380ba18fb5ce91b270bcf2efd1caf60cde83',
    observedDate: '2026-10-30',
    environment:
      'Actual signed JWT/JWKS HTTP/restricted SQL and SDK committed corrupt branch reply recovery by GET only; synthetic fixture',
  },
  directoryDomain230: {
    path: 'docs/evidence/staff-directory-domain230-full.txt',
    counts: [321],
    commit: '09e489e6eec15cfdabbc48f8cbd2b522cf8acb3b',
    observedDate: '2026-10-30',
    environment:
      'Full domain regression including private branch and invitation page contracts; no UI/provider claim',
  },
  directorySql230: {
    path: 'docs/evidence/staff-directory-sql230-final.txt',
    counts: [3],
    commit: '09e489e6eec15cfdabbc48f8cbd2b522cf8acb3b',
    observedDate: '2026-10-30',
    environment:
      'Isolated restricted SQL directory projections bound to shared validators; no migration promotion',
  },
  directoryApi231: {
    path: 'docs/evidence/staff-directory-api231-final.txt',
    counts: [8],
    commit: '09e489e6eec15cfdabbc48f8cbd2b522cf8acb3b',
    observedDate: '2026-10-30',
    environment:
      'Focused invitation and directory API regression; configured company and verified subject with fail-closed projections',
  },
  directorySdk232: {
    path: 'docs/evidence/staff-directory-sdk232-full.txt',
    counts: [314],
    commit: '09e489e6eec15cfdabbc48f8cbd2b522cf8acb3b',
    observedDate: '2026-10-30',
    environment: 'Full standard SDK regression including strict bounded private directory reads',
  },
  directoryHttp232: {
    path: 'docs/evidence/staff-directory-http232-final.txt',
    counts: [8],
    commit: '09e489e6eec15cfdabbc48f8cbd2b522cf8acb3b',
    observedDate: '2026-10-30',
    environment:
      'Actual SDK and signed JWT/JWKS HTTP/restricted SQL private directory pages and role/tenant denials; disposable synthetic fixture only',
  },
  invitationHttp227: {
    path: 'docs/evidence/staff-invitation-http227-final.txt',
    counts: [6],
    commit: '83a5f73',
    observedDate: '2026-10-30',
    environment:
      'Disposable signed JWT/JWKS HTTP and restricted SQL invitation capture/revocation original GET-only recovery, role/tenant/signature/authority denials; no provider identity, grants or UI',
  },
  invitationRecords225: {
    path: 'docs/evidence/staff-invitation-records225.txt',
    counts: [7],
    commit: commits.invitations225,
    observedDate: '2026-10-30',
    environment: 'Exact immutable receipt/state/outcome and duplicate/rounded JSON contract checks',
  },

  invitationDomain224: {
    path: 'docs/evidence/staff-invitation-domain224.txt',
    counts: [310],
    commit: commits.invitations224,
    observedDate: '2026-10-30',
    environment:
      'Full domain regression including capture-only invitation intent; no invitation delivery or access grant',
  },
  branchCandidate224: {
    path: 'docs/evidence/staff-branch-sql224-final.txt',
    counts: [3],
    commit: commits.invitations224,
    observedDate: '2026-10-30',
    environment:
      'Explicit isolated branch SQL proposal in restricted PGlite; durable originals/conflict/noop and two-company/current-admin fences; not a normal migration or hosted locking proof',
  },
  invitationCandidate224: {
    path: 'docs/evidence/staff-invitation-sql224.txt',
    counts: [5],
    commit: commits.invitations224,
    observedDate: '2026-10-30',
    environment:
      'Explicit isolated capture-only invitation/revocation SQL in restricted PGlite; historical expiry fixture, no mail/token/redemption/membership grant or UI/provider acceptance',
  },

  domain223: {
    path: 'docs/evidence/2026-10-30-listing-reports/domain-full.txt',
    counts: [306],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment: 'Windows / Full report-era domain regression',
  },
  api223: {
    path: 'docs/evidence/2026-10-30-listing-reports/api-full.txt',
    counts: [312],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / Full report-era API/restricted SQL regression; runtime unchanged since proof',
  },
  sdk223: {
    path: 'docs/evidence/2026-10-30-listing-reports/sdk-full-final.txt',
    counts: [307],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment: 'Windows / Full SDK transport regression with report tests included',
  },
  web223: {
    path: 'docs/evidence/2026-10-30-listing-reports/web-full-final.txt',
    counts: [114],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment: 'Windows / Full web boundary/config/render regression',
  },
  admin223: {
    path: 'docs/evidence/2026-10-30-listing-reports/admin-full-final.txt',
    counts: [448, 34],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment: 'Windows / Full admin boundary and existing rendering regression',
  },
  signedReport223: {
    path: 'docs/evidence/2026-10-30-listing-reports/signed-http-lost-results.txt',
    counts: [3],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / Actual signed loopback HTTP/restricted SQL capture/review and committed-reply original recovery',
  },
  reportBff223: {
    path: 'docs/evidence/2026-10-30-listing-reports/admin-boundaries-final.txt',
    counts: [3],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / Admin BFF current server identity, malformed writes, uncertainty and original GET',
  },
  reportRender223: {
    path: 'docs/evidence/2026-10-30-listing-reports/admin-report-render.txt',
    counts: [1],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / Initial report SSR labels/disclosure; browser interaction verified separately',
  },
  webBuild223: {
    path: 'docs/evidence/2026-10-30-listing-reports/web-build-final.txt',
    counts: null,
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment: 'Windows / Complete one-worker web production build including TypeScript',
  },
  adminBuild223: {
    path: 'docs/evidence/2026-10-30-listing-reports/admin-build-final.txt',
    counts: null,
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment: 'Windows / Complete one-worker admin production build including TypeScript',
  },
  sqlFailed223: {
    path: 'docs/evidence/2026-10-30-listing-reports/sql-full-final.txt',
    counts: null,
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / RETAINED FAILED full run:363passed/1 stale expected-table inventory failed; no skip, corrected separately; not364/364',
  },
  sqlInventory223: {
    path: 'docs/evidence/2026-10-30-listing-reports/sql-inventory-corrected.txt',
    counts: [1],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment: 'Windows / Corrected exact table/forced-RLS inventory; no runtime SQL change',
  },
  authInventory223: {
    path: 'docs/evidence/2026-10-30-listing-reports/authorization-inventory.txt',
    counts: [1],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / All installed default private tables/definers and three restricted role privilege fences',
  },
  authApi223: {
    path: 'docs/evidence/2026-10-30-listing-reports/authorization-api.txt',
    counts: [20],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / Actual ephemeral RS256/JWKS and HTTP boundary negatives; no provider integration',
  },
  authRoles223: {
    path: 'docs/evidence/2026-10-30-listing-reports/authorization-role-tenants.txt',
    counts: [26],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / Two synthetic companies actual API/restricted SQL role/ownership/projection and pool rollback checks',
  },
  authStorage223: {
    path: 'docs/evidence/2026-10-30-listing-reports/authorization-storage.txt',
    counts: [47],
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Windows / Owned filesystem local/durable storage, forged upload authority, links and cleanup refusal',
  },
  browserReport223: {
    path: 'docs/evidence/2026-10-30-listing-reports.md',
    counts: null,
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Actual synthetic public/admin browser capture/review,320px/public unchanged and both lost-reply GET recoveries; no external messages',
  },
  authorizationReview223: {
    path: 'docs/evidence/2026-10-30-authorization-review.md',
    counts: null,
    commit: commits.reports223,
    observedDate: '2026-10-30',
    environment:
      'Local API/storage authorization review with source fingerprints and explicit production/provider/device limits',
  },

  apiLab222: {
    path: 'docs/evidence/2026-10-29-performance/api-final.json',
    counts: null,
    commit: commits.performance222,
    observedDate: '2026-10-29',
    environment:
      'Windows /actual1000-listing two-company PGlite/HTTP lab,48 timed reads/4 clients plus12 probes; metadata only, no sustainable/hosted/device capacity claim',
  },
  webLabFailed222: {
    path: 'docs/evidence/2026-10-29-performance/web-initial.json',
    counts: null,
    commit: commits.performance222,
    observedDate: '2026-10-29',
    environment:
      'Windows /retained FAILED first cold web deadline while another DB test ran; no pass inferred; incomplete local probe instrumentation corrected later',
  },
  webLab222: {
    path: 'docs/evidence/2026-10-29-performance/web-complete.json',
    counts: null,
    commit: commits.performance222,
    observedDate: '2026-10-29',
    environment:
      'Windows /current production DEMO web cold/warm headers, HTML and initial local JS gzip; no connected production DB/field vitals/CDN/device claim',
  },
  keyboard222: {
    path: 'docs/evidence/2026-10-29-public-keyboard.md',
    counts: null,
    commit: commits.performance222,
    observedDate: '2026-10-29',
    environment:
      'Actual browser /320/390/1280 reflow, focus targets,13 Tab sequence, keyboard form/gallery/navigation; bounded browser work, not full assistive technology/device audit',
  },
  web222: {
    path: 'docs/evidence/2026-10-29-public-keyboard/web-tests-complete.txt',
    counts: [109],
    commit: commits.performance222,
    observedDate: '2026-10-29',
    environment:
      'Windows /final complete109 web checks and test compilation after native fragment focus correction; earlier109 runs overlap',
  },
  webBuild222: {
    path: 'docs/evidence/2026-10-29-public-keyboard/web-build-complete.txt',
    counts: null,
    commit: commits.performance222,
    observedDate: '2026-10-29',
    environment:
      'Windows /final one-worker complete Next16.4.2 production build including TypeScript; no hosted/actual device pass',
  },
  preservation221: {
    path: 'docs/evidence/2026-10-29-preservation/verification.json',
    counts: null,
    commit: commits.preservation221,
    observedDate: '2026-10-29',
    environment:
      'Windows /2254 original file byte hashes and four read-only archive checksums/inventory reconciled; preservation only, no original/vendor UAT result imported as an application pass',
  },
  domain220: {
    path: 'docs/evidence/2026-10-29-company-settings/domain-full-final.txt',
    counts: [302],
    commit: commits.settings220,
    observedDate: '2026-10-29',
    environment:
      'Windows / full shared domain contracts including exact company settings and duplicate-key JSON; no provider/device proof',
  },
  api220: {
    path: 'docs/evidence/2026-10-29-company-settings/api-full.txt',
    counts: [307],
    commit: commits.settingsInitial,
    environment:
      'Windows / retained full current API run; settings service source unchanged by later admin-only reconciliation/status correction',
  },
  database220: {
    path: 'docs/evidence/2026-10-29-company-settings/database-full.txt',
    counts: [357],
    commit: commits.settingsInitial,
    observedDate: '2026-10-29',
    environment:
      'Windows / full default restricted PGlite schema including immutable approved settings/current roles/tenant/original recovery; no hosted concurrent PostgreSQL proof',
  },
  admin220: {
    path: 'docs/evidence/2026-10-29-company-settings/admin-full-final.txt',
    counts: [445, 34],
    commit: commits.settings220,
    observedDate: '2026-10-29',
    environment:
      'Windows / complete admin logic/BFF and SSR UI suites after final pending-state/status correction; no production identity or device pass',
  },
  web220: {
    path: 'docs/evidence/2026-10-29-company-settings/web-full.txt',
    counts: [109],
    commit: commits.settingsInitial,
    environment:
      'Windows / full web contract/SSR/transport suite including configured-company anonymous settings read; web source unchanged afterward',
  },
  signed220: {
    path: 'docs/evidence/2026-10-29-company-settings/signed-final.txt',
    counts: [3],
    commit: commits.settingsInitial,
    observedDate: '2026-10-29',
    environment:
      'Windows / real ephemeral RS256 HTTP and restricted SQL / approval, original replay after deliberately lost reply, public projection and agent denial',
  },
  browser220: {
    path: 'docs/evidence/2026-10-29-company-settings.md',
    counts: null,
    commit: commits.settings220,
    observedDate: '2026-10-29',
    environment:
      'Windows / actual synthetic settings editor, four approvals, lost-result recovery, cross-tab version conflict/rebase/adoption, keyboard/320px and anonymous public readback; extra stale-instance browser check not run',
  },
  builds220: {
    path: 'docs/evidence/2026-10-29-company-settings/verification-summary.json',
    counts: null,
    commit: commits.settings220,
    observedDate: '2026-10-29',
    environment:
      'Windows / all workspace typechecks, full current admin/web production builds with one worker, exact executed counts and teardown limits; no hosted Actions/device/release proof',
  },
  ci219: {
    path: 'docs/evidence/2026-10-29-ci-efficiency/local-planner-final.txt',
    counts: [8],
    commit: commits.ci219,
    observedDate: '2026-10-29',
    environment:
      'Windows / local dependency-free CI planner with real disposable Git ranges; no hosted Actions run, account/budget change or application acceptance',
  },
  design218: {
    path: 'docs/evidence/2026-10-29-connected-design.md',
    counts: null,
    commit: commits.design218,
    environment:
      'Windows / in-app browser /16 prototype screens at1280/320px,390px public and critical in-memory recovery/decision flows; design-only, no backend/device/operator acceptance',
  },
  api217: {
    path: 'docs/evidence/2026-10-29-public-gallery/api-full.txt',
    counts: [307],
    commit: commits.gallery217,
    environment:
      'Windows / full current API, public anonymous sealed-image boundary and retained draft/reviewer authorization; SQL/adapters plus doubles',
  },
  database217: {
    path: 'docs/evidence/2026-10-29-public-gallery/database-full.txt',
    counts: [353],
    commit: commits.gallery217,
    environment:
      'Windows / full default-schema restricted PGlite including public-current publication/freshness/provenance and role checks; no hosted concurrent sessions',
  },
  web217: {
    path: 'docs/evidence/2026-10-29-public-gallery/web-full-final.txt',
    counts: [107],
    commit: commits.gallery217,
    environment:
      'Windows / compiled web models, SSR markup and bounded anonymous proxy transport tests; physical devices not exercised',
  },
  signed217: {
    path: 'docs/evidence/2026-10-29-public-gallery/signed-http-full.txt',
    counts: [96],
    commit: commits.gallery217,
    environment:
      'Windows / complete signed loopback HTTP and restricted SQL; actual four-image native upload/codec/approval/anonymous decode/pause journey included',
  },
  browser217: {
    path: 'docs/evidence/2026-10-29-public-gallery.md',
    counts: null,
    commit: commits.gallery217,
    environment:
      'Windows / actual public Next/native browser gallery, keyboard pause/error/refresh/resume, four decoded images, exact fees and320/390px layout/area privacy; no real device/operator/full accessibility audit',
  },
  media216: {
    path: 'docs/evidence/2026-10-28-live-media-retirement/media-full-final.txt',
    counts: [207],
    commit: commits.media216,
    environment:
      'Windows / actual supervisor, codec, restricted SQL and filesystem plus contract doubles; live same-instance retirement, synthetic historical expiry fixtures, not production retention',
  },
  signed216: {
    path: 'docs/evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt',
    counts: [95],
    commit: commits.media216,
    environment:
      'Windows / complete current signed loopback HTTP, restricted SQL and actual native image boundaries; synthetic tenants only',
  },
  admin216: {
    path: 'docs/evidence/2026-10-28-live-media-retirement/admin-tests-final.txt',
    counts: [441, 33],
    commit: commits.media216,
    environment:
      'Windows / compiled admin boundaries and SSR plus actual held-loopback transport cancellation; no device acceptance',
  },
  browser216: {
    path: 'docs/evidence/2026-10-28-live-media-retirement.md',
    counts: null,
    commit: commits.media216,
    environment:
      'Windows / actual synthetic native-backed admin browser cancellation, corrupt input, 0/3 refusal, 4/12 decoded gallery, 12 submission and narrow keyboard checks; thirteenth API refusal separate, no physical device',
  },
  media215: {
    path: 'docs/evidence/2026-10-28-expired-media-cleanup/media-full-current.txt',
    counts: [205],
    commit: commits.media215,
    environment:
      'Windows / full media suite, actual native codec/supervisor, restricted SQL and owned-filesystem expiry plus contract doubles; offline foundation, not a running sweeper',
  },
  database215: {
    path: 'docs/evidence/2026-10-28-expired-media-cleanup/database-full-corrected.txt',
    counts: [350],
    commit: commits.media215,
    environment:
      'Windows / complete corrected default-schema restricted PGlite regression including forced-RLS and separate exact processing/maintenance grants; no hosted PostgreSQL race claim',
  },
  calendar214: {
    path: 'docs/evidence/2026-10-28-viewing-calendar.md',
    counts: null,
    commit: commits.calendar214,
    environment:
      'Windows / actual synthetic browser request/calendar/confirmation/cancellation/history/reassignment and capture-only uncertainty recovery; no external delivery or device acceptance',
  },
  signed214: {
    path: 'docs/evidence/2026-10-28-viewing-calendar/signed-http-full-current.txt',
    counts: [90],
    commit: commits.calendar214,
    environment:
      'Windows / actual loopback signed HTTP and restricted PGlite, two synthetic companies; full current dev suite',
  },
  admin214: {
    path: 'docs/evidence/2026-10-28-viewing-calendar/admin-tests.txt',
    counts: [437, 33],
    commit: commits.calendar214,
    environment:
      'Windows / compiled admin boundaries and SSR UI checks including calendar/date/navigation semantics',
  },
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
    observedDate: definition.observedDate ?? '2026-10-28',
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
    [
      'api212',
      'signed212',
      'admin212',
      'staffSql248',
      'staffApi248',
      'staffSigned248',
      'staffBrowser248',
    ],
    'Current signed customer, revoked and foreign actor denials; server-owned staff access and guarded listing commands.',
    'Production identity, native route bypass and deployed storage permissions still require verification.',
    'Complete the real identity/browser/native denial matrix on the release candidate.',
  ],
  [
    3,
    'partial',
    ['api212', 'signed212', 'sdk212', 'media213', 'staffSql248', 'staffApi248', 'staffSigned248'],
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
    ['media216', 'signed216', 'admin216', 'browser216', 'database215'],
    'Actual browser Cancel at third upload preserved two photos and recovered the original confirmed stop. Live original-instance retirement/drain, exact authorized incomplete workspace cleanup, verified/reference protection and uncertainty guards passed locally.',
    'Production provider retention/schedule/alerts, hosted process isolation and actual Android/iOS/operator interruption journeys remain open.',
    'Verify staged provider lifecycle and actual devices; historical journals never grant new cleanup authority.',
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
    ['search210', 'operations212', 'domain212', 'browser217', 'web217'],
    'Exact web/admin KES and period presentation observed, including connected public base/recurring/deposit/initial figures at320px; domain money rules tested.',
    'Favourites and actual mobile exact-price presentation are incomplete or unverified.',
    'Build favourites and verify the neighbouring prices in every listed surface.',
  ],
  [
    12,
    'partial',
    ['domain212', 'api217', 'sdk212', 'admin212', 'operations212', 'browser217', 'web217'],
    'Exact fee/period/quote-required contract, submitted review and connected public named fees/deposit/initial subtotals are verified locally, including320px disclosure.',
    'Native full fee disclosure and normalized authoring/import acceptance remain open.',
    'Repeat all known/unknown fee cases through normalized authoring and actual native devices.',
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
    ['api212', 'signed214', 'admin214', 'calendar214', 'operations212'],
    'Current authorized Nairobi calendar and fresh inspection links verified through reschedule, renewed phone agreement, cancellation, six retained states, unscheduled request/proposal and reassignment. Capture-only uncertainty recovers the original record without sending; external delivery is explicitly unavailable.',
    'Outbound provider/consent/cadence/failure reconciliation and native/operator acceptance remain open; capture records are not delivered notifications.',
    'Integrate the controlled notification provider and verify failed/delayed/suppressed delivery with an approved test destination, then complete native/operator journeys.',
  ],
  [
    18,
    'partial',
    ['media216', 'signed217', 'admin216', 'browser216', 'api217', 'browser217'],
    'Actual signed/native0/3/4/12/13 and duplicate-finalize checks passed. Browser0/3 submission refusal, four and twelve decoded images, disabled thirteenth selection and twelve-image pending confirmation observed.',
    'Actual native devices, hosted concurrent catalogue/gallery changes and operator acceptance remain open; no browser4-image submit in this run is claimed.',
    'Repeat the photo boundary/recovery matrix on release devices and staging; retain independent API thirteenth refusal.',
  ],
  [
    19,
    'partial',
    ['media216', 'signed217', 'admin216', 'browser216', 'api217', 'database217', 'browser217'],
    'Actual codec format/metadata/corrupt/dimension/byte caps and upload recovery passed. Public bytes now require current approved/fresh publication and matching native seals before/after I/O; four actual anonymous WebPs decoded and pause denied later access.',
    'Production object provider access and actual device interruption/oversized-selection matrix remain open.',
    'Verify deployed object isolation and complete invalid/oversized device selections with approved test bytes.',
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
    [
      'keyboard222',
      'web222',
      'search210',
      'operations212',
      'admin212',
      'mobile211',
      'browser217',
      'web217',
    ],
    'Main/search/native approach focus corrected and observed;13-control keyboard sequence, form/gallery/navigation and320/390/1280 reflow complement connected boundary/gallery evidence.',
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
    ['domain212', 'api217', 'signed217', 'operations212', 'database217', 'browser217'],
    'Availability guards,720-hour stale queue and public image SQL eligibility distinguish fresh/paused/stale/foreign stock. Actual browser pause removes newly requested bytes/public page; resume restores four decoded images.',
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
    'partial',
    ['apiLab222', 'webLabFailed222', 'webLab222'],
    'Actual1000-listing/two-company loopback lab measured48 reads/4 clients, p95=536.007ms; current production demo web warm p95 headers<=44.437ms. Original five-second cold failure retained; limits fixed before measurement.',
    'Actual media/slow-network, private workload, hosted PostgreSQL/provider capacity and field Web Vitals remain unmeasured.',
    'Repeat the bounded lab in approved staging with actual media/private workloads and collect consented field metrics before a production capacity decision.',
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
  if ([2, 3, 19, 30, 35].includes(number))
    evidence.push('authorizationReview223', 'authInventory223', 'authRoles223', 'authStorage223');
  if ([19, 35].includes(number)) evidence.push('browserReport223', 'signedReport223');
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
    id: 'FIX-248-01',
    cases: ['AC-002', 'AC-007'],
    problem:
      'Development staff BFF rejected canonical forwarded metadata automatically added by the installed Next Node adapter.',
    status: 'retested_in_stated_environment',
    evidence: 'staffBoundary248',
    before: 'docs/evidence/staff-boundary248-before.txt',
    remaining:
      'Exact loopback metadata is transport-only; actual owned browser branch/capture/revocation GET recovery also observed. Production proxy/provider/device acceptance remains open.',
  },
  {
    id: 'FIX-216-01',
    cases: ['AC-005', 'AC-030'],
    problem: 'Retired byte handler parsed route/identity before refusing new admission.',
    status: 'retested_in_stated_environment',
    evidence: 'signed216',
    before: 'docs/evidence/2026-10-28-live-media-retirement/pipeline-focused.txt',
    remaining:
      'Outer fence now refuses before body/identity/SQL; production hosting/retention remains open.',
  },
  {
    id: 'FIX-216-02',
    cases: ['AC-005', 'AC-019'],
    problem:
      'Failed native conversion PUT described confirmed failure while original GET described processing.',
    status: 'retested_in_stated_environment',
    evidence: 'signed216',
    before: 'docs/evidence/2026-10-28-live-media-retirement/native-photo-boundaries.txt',
    remaining:
      'Matching retained failure facts are descriptive only; no new launch/deletion authority and no unknown-containment success.',
  },
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
  updatedAt: '2026-11-02',
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
</style><main><header><a href="index.html">← Delivery checklist</a><p>INDEPENDENT REBUILD / ACCEPTANCE EVIDENCE / 2 NOVEMBER 2026</p><h1>What was checked. What still needs work.</h1><p>Each original finding now leads to a replacement case, bounded execution evidence and an explicit next action. Old vendor results are historical evidence.</p><p class="notice"><strong>No release acceptance is implied.</strong> Partial checks, not-run cases and deferred modules stay explicit. Suite totals overlap. Actual devices, provider/account facts, operator UAT and cutover gates remain open.</p></header><div class="metrics"><span><strong>24</strong>original findings</span><span><strong>35</strong>replacement cases linked</span><span><strong>${fixes.length}</strong>bounded defect retests</span><span><strong>0 / 14</strong>accepted release gates</span></div><section aria-labelledby="case-title"><h2 id="case-title">Cases and next actions</h2><div class="filters"><label for="case-search">Find a case, requirement or gap<input id="case-search" type="search" placeholder="For example: upload or AC-005"></label><label for="case-state">Evidence state<select id="case-state"><option value="all">All cases</option><option value="partial">Partial evidence</option><option value="not_run">Not run</option><option value="deferred">Deferred</option><option value="reserved">Reserved correction</option></select></label></div><p id="case-count" role="status">35 cases shown</p><div id="case-list">${entries.map((entry) => `<article data-state="${entry.status}" id="${entry.id}"><h3>${entry.id} · ${escape(entry.title)}</h3><small>${escape(entry.requirement ?? 'Additional replacement gate')} · ${escape(entry.gapId ?? 'Reserved header correction')}</small><span class="state">${escape(entry.status.replaceAll('_', ' '))}</span><p><strong>Observed:</strong> ${escape(entry.observed)}</p><p><strong>Still open:</strong> ${escape(entry.remaining)}</p><p><strong>Next:</strong> ${escape(entry.nextAction)}</p><small>Owner: ${escape(entry.owner)}</small><details><summary>Expected result and evidence</summary>${entry.originalFinding ? `<p>Original finding: ${escape(entry.originalFinding.title)}</p>` : ''}<p>${escape(entry.expected)}</p><p>${entry.evidence.length ? evidenceLinks(entry.evidence) : 'No product execution pass attached.'}</p><p>No complete release-case pass recorded.</p></details></article>`).join('')}</div><p id="case-empty" hidden>No cases match. Clear the search or choose all cases.</p></section><section aria-labelledby="fix-title"><h2 id="fix-title">Fixed defects and bounded retests</h2>${fixes.map((fix) => `<article><h3>${fix.id}</h3><p>${escape(fix.problem)}</p><p>${escape(fix.cases.join(', '))} · ${evidenceLinks([fix.evidence])}</p><p>${escape(fix.remaining)}</p></article>`).join('')}</section><footer><a href="acceptance-status.json" download>Download structured case ledger</a> · <a href="acceptance-status.md" download>Download detailed notes</a><p>Source report preserved byte-for-byte. Other text evidence hashes normalize CRLF to LF for portable checks. Run <code>node scripts/acceptance-status.mjs</code> in the canonical repository to verify the index. Maintenance does not close product defects automatically.</p></footer></main><script>
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
