import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, realpath, lstat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slash = (p) => p.split(sep).join('/');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function inside(base, target) {
  const p = relative(base, target);
  if (
    isAbsolute(p) ||
    p === '..' ||
    p.startsWith('..' + sep) ||
    resolve(base, p) !== resolve(target)
  )
    throw Error('Runtime source escaped its root.');
  return p;
}
export function allowedRuntimePath(path) {
  if (
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((x) => !x || x === '.' || x === '..')
  )
    return false;
  const parts = path.split('/');
  if (
    parts.some(
      (x) =>
        x === '.git' ||
        x === '.cache' ||
        x === '.bin' ||
        x.startsWith('.env') ||
        ['.npmrc', '.netrc', 'id_rsa', 'id_ed25519'].includes(x) ||
        /\.(key|p12|pfx|keystore|jks)$/i.test(x) ||
        /^(service[-_]?account|credentials).*\.json$/i.test(x),
    )
  )
    return false;
  if (path.startsWith('node_modules/')) return true;
  if (/^packages\/(domain|demo|api-client|media|browser-auth)\/(dist\/|package\.json$)/.test(path))
    return true;
  return (
    path === 'package.json' ||
    /^apps\/(web|admin|api)\/(package\.json$|server\.js$|dist\/|public\/|\.next\/(?!cache\/))/.test(
      path,
    )
  );
}
/** Materialize links as regular files, with no output references to the original checkout. */
export async function copyRuntimeFile(sourceRoot, source, destinationRoot, name, inventory) {
  if (!allowedRuntimePath(name)) throw Error('Unexpected or sensitive runtime path: ' + name);
  const actual = await realpath(source);
  inside(await realpath(sourceRoot), actual);
  const stat = await lstat(actual);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('Invalid runtime file.');
  const bytes = await readFile(actual);
  if (
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{64,}-----END (?:[A-Z]+ )?PRIVATE KEY-----/.test(
      bytes.toString('utf8').replaceAll('\\n', '\n'),
    )
  )
    throw Error('Private key refused in runtime package.');
  const digest = hash(bytes),
    existing = inventory.get(name);
  if (existing) {
    if (existing.sha256 !== digest) throw Error('Conflicting runtime file.');
    return;
  }
  const target = resolve(destinationRoot, name);
  inside(destinationRoot, target);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  inventory.set(name, { path: name, sha256: digest, bytes: bytes.length });
}
export async function copyRuntimeTree(
  sourceRoot,
  from,
  destinationRoot,
  prefix,
  inventory,
  parents = new Set(),
) {
  const actual = await realpath(from);
  inside(await realpath(sourceRoot), actual);
  if (parents.has(actual)) throw Error('Cyclic runtime link refused.');
  const stat = await lstat(actual);
  if (stat.isFile()) return copyRuntimeFile(sourceRoot, actual, destinationRoot, prefix, inventory);
  if (!stat.isDirectory()) throw Error('Unsupported runtime entry.');
  const next = new Set([...parents, actual]);
  for (const entry of (await readdir(actual)).sort())
    await copyRuntimeTree(
      sourceRoot,
      resolve(actual, entry),
      destinationRoot,
      prefix ? prefix + '/' + entry : entry,
      inventory,
      next,
    );
}
function acceptedTraceWarning(message) {
  const m = message.replaceAll(root, '<root>').replaceAll('\\', '/');
  return (
    /^Failed to resolve dependency "pg-native":\nCannot find module 'pg-native' loaded from <root>\/node_modules\/pg\/lib\/native\/client\.js$/.test(
      m,
    ) ||
    /^Failed to resolve dependency "cloudflare:sockets":\nCannot find module 'cloudflare:sockets' loaded from <root>\/node_modules\/pg-cloudflare\/dist\/index\.js$/.test(
      m,
    ) ||
    /^Failed to parse <root>\/node_modules\/@grpc\/grpc-js\/proto\/(xds|protoc-gen-validate)\/LICENSE as (script|module):\nUnexpected token \([0-9]+:[0-9]+\)$/.test(
      m,
    )
  );
}
async function stageApi(destination, inventory) {
  const { nodeFileTrace } = createRequire(import.meta.url)('next/dist/compiled/@vercel/nft');
  const trace = await nodeFileTrace(['apps/api/dist/hosted-index.js'], {
    base: root,
    processCwd: root,
    mixedModules: true,
  });
  const warnings = [...trace.warnings].map((e) => e.message);
  if (warnings.some((m) => !acceptedTraceWarning(m))) throw Error('Unreviewed API trace warning.');
  const links = ['domain', 'demo', 'api-client', 'media', 'browser-auth'].map((name) => ({
    name: 'node_modules/@realtor/' + name,
    target: resolve(root, 'packages', name),
  }));
  for (const path of trace.fileList) {
    const full = resolve(root, path);
    if ((await lstat(full)).isSymbolicLink() && (await lstat(await realpath(full))).isDirectory())
      links.push({ name: slash(path), target: await realpath(full) });
  }
  for (const path of [...trace.fileList].sort()) {
    const full = resolve(root, path),
      actual = await realpath(full);
    inside(root, actual);
    if ((await lstat(actual)).isDirectory()) continue;
    await copyRuntimeFile(root, full, destination, slash(path), inventory);
    for (const link of links) {
      const suffix = relative(link.target, actual);
      if (suffix && !suffix.startsWith('..') && !suffix.includes(':'))
        await copyRuntimeFile(
          root,
          actual,
          destination,
          link.name + '/' + slash(suffix),
          inventory,
        );
    }
  }
  return warnings.map((m) => m.replaceAll(root, '<workspace>'));
}
export async function verifyRuntimeInventory(directory, manifest) {
  if (
    !Array.isArray(manifest.files) ||
    new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length
  )
    throw Error('Invalid runtime inventory.');
  const expected = new Map(manifest.files.map((f) => [f.path, f]));
  async function visit(dir, prefix = '') {
    for (const name of await readdir(dir)) {
      const full = resolve(dir, name),
        path = prefix ? prefix + '/' + name : name,
        stat = await lstat(full);
      if (stat.isSymbolicLink()) throw Error('Runtime inventory contains a link.');
      if (stat.isDirectory()) {
        await visit(full, path);
        continue;
      }
      if (!stat.isFile()) throw Error('Unsupported runtime inventory entry.');
      const record = expected.get(path);
      if (!record || !allowedRuntimePath(path)) throw Error('Unrecorded runtime file.');
      const bytes = await readFile(full);
      if (bytes.length !== record.bytes || hash(bytes) !== record.sha256)
        throw Error('Runtime digest mismatch.');
      expected.delete(path);
    }
  }
  await visit(directory);
  if (expected.size) throw Error('Missing runtime files.');
}
export async function stageRuntimePackages() {
  const buildRoot = resolve(root, '.staging-artifacts');
  await mkdir(buildRoot, { recursive: true });
  if ((await realpath(buildRoot)) !== buildRoot) throw Error('Artifact root must not be a link.');
  const output = await mkdtemp(resolve(buildRoot, 'runtime-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const provenance = {
    sourceCommit: git('rev-parse', 'HEAD'),
    sourceDirty: git('status', '--porcelain').length > 0,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    lockfileSha256: hash(await readFile(resolve(root, 'package-lock.json'))),
  };
  const result = {
    policy: 'realtor-staging-runtime-packages-v1',
    ...provenance,
    services: {},
    liveDeploymentVerified: false,
  };
  for (const service of ['api', 'web', 'admin']) {
    const destination = resolve(output, service),
      inventory = new Map();
    await mkdir(destination);
    let traceWarnings = [];
    if (service === 'api') traceWarnings = await stageApi(destination, inventory);
    else {
      await copyRuntimeTree(
        root,
        resolve(root, 'apps', service, '.next/standalone'),
        destination,
        '',
        inventory,
      );
      await copyRuntimeTree(
        root,
        resolve(root, 'apps', service, '.next/static'),
        destination,
        'apps/' + service + '/.next/static',
        inventory,
      );
      let hasPublic = false;
      try {
        await lstat(resolve(root, 'apps', service, 'public'));
        hasPublic = true;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (hasPublic) {
        await copyRuntimeTree(
          root,
          resolve(root, 'apps', service, 'public'),
          destination,
          'apps/' + service + '/public',
          inventory,
        );
      }
    }
    const files = [...inventory.values()].sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      entry: service === 'api' ? 'apps/api/dist/hosted-index.js' : 'apps/' + service + '/server.js',
      ...provenance,
      files,
      traceWarnings,
    };
    await verifyRuntimeInventory(destination, manifest);
    await writeFile(
      resolve(output, service + '-inventory.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx' },
    );
    result.services[service] = {
      entry: manifest.entry,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
      inventorySha256: hash(await readFile(resolve(output, service + '-inventory.json'))),
      traceWarnings,
    };
  }
  await writeFile(
    resolve(output, 'runtime-packages.json'),
    JSON.stringify(result, null, 2) + '\n',
    { flag: 'wx' },
  );
  return { directory: output, ...result };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await stageRuntimePackages(), null, 2));
  } catch {
    console.error('Runtime packaging failed. No deployment occurred.');
    process.exitCode = 1;
  }
}
