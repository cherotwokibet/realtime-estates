import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { suiteNames, planTestGroups, groupCommands } from './test-suite-group.mjs';
const script = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  .scripts.test;
test('parallel CI includes every canonical serial test command exactly once across isolated groups', () => {
  const { groups } = planTestGroups(script),
    serial = script.split(' && ').slice(1),
    parallel = Object.values(groups).flat();
  assert.equal(parallel.length, serial.length);
  assert.equal(new Set(parallel).size, parallel.length);
  assert.deepEqual([...parallel].sort(), [...serial].sort());
  for (const name of suiteNames) {
    assert.ok(groups[name].length);
    assert.deepEqual(groupCommands(script, name).slice(0, 2), [
      'npm run build:packages',
      'npm run build --workspace=@realtor/api',
    ]);
  }
});
test('missing, duplicated, new or shell-modified test commands fail closed to coverage review', () => {
  for (const changed of [
    undefined,
    'npm run test:database',
    script + ' && npm run extra',
    script.replace('npm run test:mobile', 'npm run test:media'),
    script.replace('npm run test:mobile', 'npm run test:mobile; echo skipped'),
    script.replace('npm run build:packages', 'npm run build:other'),
  ])
    assert.throws(() => planTestGroups(changed));
  assert.throws(() => groupCommands(script, 'unknown'));
});
test('workflow runs every isolated test group and gates the required result on matrix success', () => {
  const text = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const name of suiteNames) assert.ok(text.includes(name));
  assert.match(text, /node scripts\/ci\/test-suite-group\.mjs/);
  assert.match(text, /needs: \[plan, tests\]/);
  assert.match(text, /TESTS_RESULT: \$\{\{ needs.tests.result \}\}/);
  assert.doesNotMatch(text, /continue-on-error:/);
});

test('preview isolation compiles the imported web test helpers before dev HTTP tests', () => {
  const commands = groupCommands(script, 'previews-mobile-media');
  assert.ok(
    commands.indexOf('npm run test:compile --workspace=@realtor/web') <
      commands.indexOf('node --test --test-concurrency=1 apps/api/dev/*.test.mjs'),
  );
  assert.ok(commands.includes('npm run test:compile --workspace=@realtor/web'));
});
