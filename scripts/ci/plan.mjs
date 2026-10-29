/** Conservative, dependency-free CI planning. This script never runs or claims application tests. */
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const all = (reason) => ({ verify: true, web: true, admin: true, mobile: true, reason });
const documentation = (path) =>
  path.startsWith('docs/') ||
  ['README.md', 'LICENSE', 'LICENSE.md'].includes(path) ||
  /^scripts\/checkpoint-[a-z0-9-]+\.mjs$/.test(path);
export function classifyChanges(paths) {
  if (
    !Array.isArray(paths) ||
    paths.some(
      (p) =>
        typeof p !== 'string' ||
        !p ||
        p.startsWith('/') ||
        p.includes('\\') ||
        p.split('/').includes('..') ||
        /[\u0000-\u001f\u007f]/u.test(p),
    )
  )
    return all('invalid-file-list');
  const relevant = paths.filter((p) => !documentation(p));
  if (relevant.length === 0)
    return {
      verify: false,
      web: false,
      admin: false,
      mobile: false,
      reason: 'documentation-or-tracker-only',
    };
  let web = false,
    admin = false,
    mobile = false;
  for (const path of relevant) {
    if (path.startsWith('apps/web/')) web = true;
    else if (path.startsWith('apps/admin/')) admin = true;
    else if (path.startsWith('apps/mobile/')) mobile = true;
    else if (path.startsWith('apps/api/') || path.startsWith('database/')) {
      /* Full tests/types remain required; unchanged frontend code need not be bundled again. */
    } else return all('shared-tooling-or-unknown-change');
  }
  return { verify: true, web, admin, mobile, reason: 'runtime-change-full-tests-and-types' };
}
/** Only an available ancestor may justify skipping work. Missing/shallow/invalid history runs everything. */
export function planVerification({ eventName, event, cwd = process.cwd() }) {
  if (eventName === 'workflow_dispatch') return all('manual-full-verification');
  if (!['push', 'pull_request'].includes(eventName) || !event || typeof event !== 'object')
    return all('unknown-event');
  const before = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  if (typeof before !== 'string' || !/^[0-9a-f]{40}$/.test(before) || /^0+$/.test(before))
    return all('missing-base');
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
  try {
    git('cat-file', '-e', before + '^{commit}');
    git('merge-base', '--is-ancestor', before, 'HEAD');
    // --no-renames retains deleted runtime paths when files are renamed into docs.
    const output = git(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--name-only',
      '-z',
      before,
      'HEAD',
      '--',
    );
    return classifyChanges(output.split('\0').filter(Boolean));
  } catch {
    return all('unavailable-or-unrelated-base');
  }
}
export function runPlanner(env = process.env) {
  let result;
  try {
    result = planVerification({
      eventName: env.GITHUB_EVENT_NAME,
      event: JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')),
    });
  } catch {
    result = all('unreadable-event');
  }
  const outputs =
    ['verify', 'web', 'admin', 'mobile'].map((key) => key + '=' + String(result[key])).join('\n') +
    '\n';
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, outputs);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      '## Verification scope\n\nReason: `' +
        result.reason +
        '`.\n\n' +
        (result.verify
          ? 'Full application tests and workspace types are required. Selected production builds: ' +
            ['web', 'admin', 'mobile'].filter((k) => result[k]).join(', ') +
            '.'
          : 'Only documentation/tracker files changed. Application tests/builds were not run and no application test pass is claimed.') +
        '\n',
    );
  console.log(JSON.stringify(result));
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runPlanner();
