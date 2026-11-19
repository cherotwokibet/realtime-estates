import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const suiteNames = Object.freeze([
  'domain-api',
  'sdk-database',
  'web-admin',
  'previews-mobile-media',
]);
const assignments = new Map([
  ['npm run test --workspace=@realtor/domain', 'domain-api'],
  ['npm run test --workspace=@realtor/demo', 'domain-api'],
  ['npm run test --workspace=@realtor/api', 'domain-api'],
  ['npm run test --workspace=@realtor/api-client', 'sdk-database'],
  ['npm run test:integration --workspace=@realtor/api-client', 'sdk-database'],
  ['npm run test:database', 'sdk-database'],
  ['npm run test --workspace=@realtor/browser-auth', 'web-admin'],
  ['npm run test --workspace=@realtor/web', 'web-admin'],
  ['npm run test --workspace=@realtor/admin', 'web-admin'],
  ['npm run test:reference-integration --workspace=@realtor/admin', 'web-admin'],
  ['npm run test:allocation-integration --workspace=@realtor/admin', 'web-admin'],
  ['node --test --test-concurrency=1 apps/api/dev/*.test.mjs', 'previews-mobile-media'],
  ['npm run test:mobile', 'previews-mobile-media'],
  ['npm run test:media', 'previews-mobile-media'],
]);
/** Derive coverage from the canonical serial suite. Unknown/duplicate commands stop CI instead of disappearing. */
export function planTestGroups(script) {
  if (typeof script !== 'string') throw Error('Canonical test script required.');
  const commands = script.split(' && ');
  if (
    commands.shift() !== 'npm run build:packages' ||
    commands.length !== assignments.size ||
    new Set(commands).size !== commands.length ||
    commands.some((c) => !assignments.has(c))
  )
    throw Error('Canonical test suite changed; review parallel coverage.');
  const groups = Object.fromEntries(
    suiteNames.map((n) => [n, commands.filter((c) => assignments.get(c) === n)]),
  );
  return { prepare: ['npm run build:packages', 'npm run build --workspace=@realtor/api'], groups };
}
export function groupCommands(script, name) {
  if (!suiteNames.includes(name)) throw Error('Unknown CI test group.');
  const plan = planTestGroups(script);
  return [...plan.prepare, ...plan.groups[name]];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const command of groupCommands(scripts.test, process.argv[2])) {
    console.log('CI suite ' + process.argv[2] + ': ' + command);
    // Every command is an exact reviewed literal from assignments/prepare, not caller shell text.
    const r = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' });
    if (r.status !== 0) {
      process.exitCode = r.status ?? 1;
      break;
    }
  }
}
