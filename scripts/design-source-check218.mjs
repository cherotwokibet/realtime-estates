/** Bounded design-source verification; does not run product or browser tests. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const names = ['docs/design/connected-journeys.html', 'docs/design/connected-journeys.md'];
const files = [];
for (const path of names) {
  const bytes = await readFile(new URL(path, root));
  if (path.endsWith('.html')) {
    const scripts = [...bytes.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)];
    if (scripts.length !== 1) throw Error('Expected one standalone prototype script');
    new vm.Script(scripts[0][1]);
  }
  files.push({
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  });
}
const result = {
  recordedAt: new Date().toISOString(),
  syntax: 'passed',
  prettier: 'checked separately before recording',
  scope: 'Prototype source parse/hash only; no product/runtime/browser suites',
  files,
};
await writeFile(
  new URL('docs/evidence/2026-10-29-connected-design/source-check.json', root),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
