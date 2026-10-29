import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyChanges, planVerification } from './plan.mjs';
test('formatting preserves immutable source evidence and deterministic generated indexes while keeping application code checked', () => {
  const ignore = readFileSync(new URL('../../.prettierignore', import.meta.url), 'utf8').split(
    /\r?\n/,
  );
  for (const path of [
    'docs/source-evidence/',
    'docs/acceptance-status.html',
    'docs/acceptance-status.json',
    'docs/acceptance-status.md',
  ])
    assert.ok(ignore.includes(path));
  for (const path of ['apps/', 'apps/**', 'packages/', 'packages/**', 'scripts/', 'scripts/**'])
    assert.ok(!ignore.includes(path));
});
const full = { verify: true, web: true, admin: true, mobile: true };
const flags = (p) => Object.fromEntries(Object.keys(full).map((k) => [k, p[k]]));
test('all documentation/evidence formats and one-shot tracker scripts avoid application runners', () => {
  assert.deepEqual(
    flags(
      classifyChanges([
        'README.md',
        'docs/acceptance-status.json',
        'docs/design/connected-journeys.html',
        'docs/evidence/raw.log',
        'docs/evidence/screenshot.jpg',
        'scripts/checkpoint-design218.mjs',
      ]),
    ),
    { verify: false, web: false, admin: false, mobile: false },
  );
});
test('runtime code always requires the full tests/types with only affected frontend production builds', () => {
  for (const [path, build] of [
    ['apps/web/app/page.tsx', 'web'],
    ['apps/admin/lib/editor.ts', 'admin'],
    ['apps/mobile/App.tsx', 'mobile'],
  ]) {
    const p = classifyChanges(['docs/note.md', path]);
    assert.equal(p.verify, true);
    for (const k of ['web', 'admin', 'mobile']) assert.equal(p[k], k === build);
  }
  for (const p of ['apps/api/src/service.ts', 'database/migrations/new.sql'])
    assert.deepEqual(flags(classifyChanges([p])), {
      verify: true,
      web: false,
      admin: false,
      mobile: false,
    });
  assert.deepEqual(flags(classifyChanges(['apps/web/new.ts', 'apps/admin/new.ts'])), {
    verify: true,
    web: true,
    admin: true,
    mobile: false,
  });
});
test('shared packages, lockfiles, workflow/planner changes and unknown/ambiguous paths fail closed to full verification', () => {
  for (const p of [
    'packages/domain/new.ts',
    'package-lock.json',
    'package.json',
    '.github/workflows/ci.yml',
    'scripts/ci/plan.mjs',
    'apps/shared/IntakeWorkspace.tsx',
    'new-root-file',
    'docs/../apps/api/new.ts',
    'docs\\new.md',
    'docs/new\nfile.md',
  ])
    assert.deepEqual(flags(classifyChanges([p])), full);
  assert.deepEqual(flags(classifyChanges(null)), full);
});
function fixture(fn) {
  const parent = realpathSync(tmpdir()),
    cwd = mkdtempSync(join(parent, 'realtor-ci-plan-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (p, s) => {
    mkdirSync(dirname(join(cwd, p)), { recursive: true });
    writeFileSync(join(cwd, p), s);
  };
  const commit = () => {
    git('add', '--all');
    git(
      '-c',
      'user.name=Synthetic CI test',
      '-c',
      'user.email=ci@example.test',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '-m',
      'Synthetic fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '--quiet');
    return fn({ cwd, git, put, commit });
  } finally {
    const actual = realpathSync(cwd);
    assert.equal(dirname(actual), parent);
    assert.ok(basename(actual).startsWith('realtor-ci-plan-'));
    rmSync(actual, { recursive: true, force: true });
  }
}
test('real Git diff includes every commit and deleted runtime paths, not only the final documentation commit', () =>
  fixture(({ cwd, put, commit }) => {
    put('apps/api/original.ts', 'old');
    const before = commit();
    put('apps/api/original.ts', 'new');
    commit();
    put('docs/proof.json', '{}');
    commit();
    assert.equal(planVerification({ eventName: 'push', event: { before }, cwd }).verify, true);
    assert.equal(
      planVerification({
        eventName: 'pull_request',
        event: { pull_request: { base: { sha: before } } },
        cwd,
      }).verify,
      true,
    );
  }));
test('real documentation-only Git diff skips bundles while absent/unrelated/unknown events require full checks', () =>
  fixture(({ cwd, put, commit }) => {
    put('README.md', 'first');
    const before = commit();
    put('docs/note.json', '{}');
    commit();
    assert.equal(planVerification({ eventName: 'push', event: { before }, cwd }).verify, false);
    for (const event of [
      {},
      { before: '0'.repeat(40) },
      { before: 'f'.repeat(40) },
      { before: '--help' },
    ])
      assert.deepEqual(flags(planVerification({ eventName: 'push', event, cwd })), full);
    assert.deepEqual(
      flags(planVerification({ eventName: 'workflow_dispatch', event: { before }, cwd })),
      full,
    );
    assert.deepEqual(
      flags(planVerification({ eventName: 'schedule', event: { before }, cwd })),
      full,
    );
  }));
test('renaming runtime content into documentation cannot bypass full tests', () =>
  fixture(({ cwd, git, put, commit }) => {
    put('apps/api/renamed.ts', 'same source');
    const before = commit();
    mkdirSync(join(cwd, 'docs'));
    git('mv', 'apps/api/renamed.ts', 'docs/renamed.md');
    commit();
    assert.equal(planVerification({ eventName: 'push', event: { before }, cwd }).verify, true);
  }));
test('workflow preserves required verify result, concurrency, pinned actions, cache, full tests/types and explicit manual full run', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /typecheck --workspaces --if-present/);
  assert.doesNotMatch(workflow, /paths-ignore:|schedule:|pull_request_target:|continue-on-error:/);
  assert.doesNotMatch(workflow, /run: npm run build:web|run: npm run typecheck\s*$/m);
  const actions = [...workflow.matchAll(/uses: ([^\s]+)/g)].map((m) => m[1]);
  assert.ok(actions.every((a) => /@[0-9a-f]{40}$/.test(a)));
  for (const target of ['web', 'admin', 'mobile'])
    assert.ok(workflow.includes('if: steps.scope.outputs.' + target + " == 'true'"));
});
