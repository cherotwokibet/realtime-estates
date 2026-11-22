/** Explicit synthetic Windows-owner custody. Never print returned secrets or use for production. */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, join, dirname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const fail = () => {
  throw Error('Synthetic recovery custody unavailable.');
};
const uuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const tenant = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(v);
const object = (v, keys) => {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).length !== keys.length
  )
    fail();
  const row = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail();
    row[key] = d.value;
  }
  return row;
};
const guard = (env) => {
  if (
    process.env.NODE_ENV === 'production' ||
    env.NODE_ENV === 'production' ||
    env.PRIVATE_RECOVERY_CUSTODY_MODE !== 'synthetic-windows-owner-v1'
  )
    fail();
};
const filePath = (file) => {
  if (
    typeof file !== 'string' ||
    !isAbsolute(file) ||
    file !== resolve(file) ||
    /[\r\n\0]/.test(file)
  )
    fail();
  return file;
};
/** Refuse source/check-out storage, including parents reached through filesystem aliases. */
async function custodyLocation(file) {
  filePath(file);
  try {
    const parent = await realpath(dirname(file)),
      workspace = await realpath(fileURLToPath(new URL('../../', import.meta.url))),
      fold = (v) => (process.platform === 'win32' ? v.toLowerCase() : v);
    if (fold(parent) === fold(workspace) || fold(parent).startsWith(fold(workspace) + sep)) fail();
  } catch {
    fail();
  }
}
const binary = (value, max) => {
  if (typeof value !== 'string' || value.length > max * 2 || !/^[A-Za-z0-9_-]+$/.test(value))
    fail();
  const b = Buffer.from(value, 'base64url');
  if (!b.length || b.length > max || b.toString('base64url') !== value) fail();
  return b;
};
const script = String.raw`$ErrorActionPreference='Stop'
try {
 Add-Type -AssemblyName System.Security
 $item=([Console]::In.ReadToEnd()|ConvertFrom-Json)
 $bytes=[Convert]::FromBase64String($item.data)
 $purpose=[Text.Encoding]::UTF8.GetBytes('realtor.synthetic.recovery.custody.v1')
 if($item.action -eq 'protect'){$result=[Security.Cryptography.ProtectedData]::Protect($bytes,$purpose,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
 elseif($item.action -eq 'open'){$result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$purpose,[Security.Cryptography.DataProtectionScope]::CurrentUser)}
 else{throw 'Invalid operation'}
 [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { [Console]::Error.Write('Recovery custody operation failed.');exit 1 }
finally {if($null -ne $bytes){[Array]::Clear($bytes,0,$bytes.Length)};if($null -ne $result){[Array]::Clear($result,0,$result.Length)}}`;
/** Fixed program, bounded stdin/stdout, no secret arguments and no plaintext file fallback. */
export function windowsRecoveryProtection() {
  if (process.platform !== 'win32') fail();
  const executable = join(
    process.env.SystemRoot ?? 'C:/Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const run = (action, bytes) =>
    new Promise((resolve, reject) => {
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 16384) {
        reject(Error('Synthetic recovery custody unavailable.'));
        return;
      }
      const child = spawn(
        executable,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let finished = false,
        length = 0,
        errorLength = 0;
      const chunks = [];
      const stop = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        child.kill();
        reject(Error('Synthetic recovery custody unavailable.'));
      };
      const timer = setTimeout(stop, 10000);
      child.on('error', stop);
      child.stdin.on('error', stop);
      child.stderr.on('data', (b) => {
        errorLength += b.length;
        if (errorLength > 4096) stop();
      });
      child.stdout.on('data', (b) => {
        length += b.length;
        if (length > 32768) stop();
        else chunks.push(b);
      });
      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(Error('Synthetic recovery custody unavailable.'));
          return;
        }
        try {
          const text = Buffer.concat(chunks).toString('ascii');
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) fail();
          const out = Buffer.from(text, 'base64');
          if (out.length > 16384 || out.toString('base64') !== text) fail();
          resolve(out);
        } catch {
          reject(Error('Synthetic recovery custody unavailable.'));
        }
      });
      child.stdin.end(JSON.stringify({ action, data: Buffer.from(bytes).toString('base64') }));
    });
  return Object.freeze({
    name: 'windows-current-user-dpapi-v1',
    protect: (b) => run('protect', b),
    open: (b) => run('open', b),
  });
}
function protection(options) {
  if (options?.testProtection) {
    if (options.testPolicy !== 'owned-disposable-fixture-v1') fail();
    if (
      options.testProtection.name !== 'owned-disposable-test-v1' ||
      typeof options.testProtection.protect !== 'function' ||
      typeof options.testProtection.open !== 'function'
    )
      fail();
    return options.testProtection;
  }
  return windowsRecoveryProtection();
}
function captureBundle(value, expectedTenant, expectedId) {
  const v = object(value, [
    'policy',
    'custodyId',
    'tenantSlug',
    'createdAt',
    'instances',
    'storageKey',
  ]);
  if (
    v.policy !== 'synthetic-recovery-custody-v1' ||
    !uuid(v.custodyId) ||
    v.custodyId !== expectedId ||
    !tenant(v.tenantSlug) ||
    v.tenantSlug !== expectedTenant ||
    typeof v.createdAt !== 'string' ||
    new Date(v.createdAt).toISOString() !== v.createdAt ||
    typeof v.storageKey !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.storageKey)
  )
    fail();
  const instances = object(v.instances, ['staff', 'admin', 'agent']);
  if (!Object.values(instances).every(uuid) || new Set(Object.values(instances)).size !== 3) fail();
  const { storageKey, ...metadata } = v;
  return Object.freeze(
    Object.defineProperty({ ...metadata, instances: Object.freeze(instances) }, 'storageKey', {
      value: storageKey,
      enumerable: false,
    }),
  );
}
export async function loadSyntheticRecoveryCustody(
  file,
  expectedTenant,
  expectedId,
  env = process.env,
  options,
) {
  guard(env);
  await custodyLocation(file);
  if (!tenant(expectedTenant) || !uuid(expectedId)) fail();
  const protector = protection(options);
  let handle;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 32768)
      fail();
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.size > 32768 ||
      current.dev !== before.dev ||
      current.ino !== before.ino
    )
      fail();
    const bytes = Buffer.alloc(32769);
    let used = 0;
    for (;;) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, null);
      used += bytesRead;
      if (used > 32768) fail();
      if (!bytesRead) break;
    }
    const encodedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
    const canonicalText = encodedText.endsWith('\n') ? encodedText.slice(0, -1) : encodedText;
    const outerValue = JSON.parse(canonicalText);
    if (JSON.stringify(outerValue) !== canonicalText) fail();
    const outer = object(outerValue, ['policy', 'protection', 'protected']);
    if (
      outer.policy !== 'protected-synthetic-recovery-custody-v1' ||
      outer.protection !== protector.name
    )
      fail();
    const plain = await protector.open(binary(outer.protected, 16384));
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(plain),
        value = JSON.parse(decoded);
      if (JSON.stringify(value) !== decoded) fail();
      return captureBundle(value, expectedTenant, expectedId);
    } finally {
      plain.fill(0);
    }
  } catch {
    fail();
  } finally {
    await handle?.close();
  }
}
/** Exclusive creation: existing, missing, corrupt or wrong-bound files are never replaced by load. */
export async function createSyntheticRecoveryCustody(file, tenantSlug, env = process.env, options) {
  guard(env);
  await custodyLocation(file);
  if (!tenant(tenantSlug)) fail();
  const protector = protection(options),
    bundle = {
      policy: 'synthetic-recovery-custody-v1',
      custodyId: randomUUID(),
      tenantSlug,
      createdAt: new Date().toISOString(),
      instances: { staff: randomUUID(), admin: randomUUID(), agent: randomUUID() },
      storageKey: randomBytes(32).toString('hex'),
    };
  const plain = Buffer.from(JSON.stringify(bundle));
  let wrapped;
  try {
    wrapped = await protector.protect(plain);
  } finally {
    plain.fill(0);
  }
  if (!Buffer.isBuffer(wrapped) || wrapped.length > 16384) fail();
  const contents =
    JSON.stringify({
      policy: 'protected-synthetic-recovery-custody-v1',
      protection: protector.name,
      protected: wrapped.toString('base64url'),
    }) + '\n';
  let handle;
  try {
    handle = await open(file, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } catch {
    fail();
  } finally {
    await handle?.close();
  }
  const checked = await loadSyntheticRecoveryCustody(
    file,
    tenantSlug,
    bundle.custodyId,
    env,
    options,
  );
  if (checked.storageKey !== bundle.storageKey) fail();
  return Object.freeze({
    policy: 'synthetic-recovery-custody-info-v1',
    custodyId: checked.custodyId,
    tenantSlug: checked.tenantSlug,
    createdAt: checked.createdAt,
    instances: checked.instances,
    protection: protector.name,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action, ...args] = process.argv.slice(2),
      values = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (
        !['--file', '--tenant', '--custody-id'].includes(key) ||
        typeof args[i + 1] !== 'string' ||
        Object.hasOwn(values, key)
      )
        fail();
      values[key] = args[i + 1];
    }
    let info;
    if (action === 'init' && !values['--custody-id'])
      info = await createSyntheticRecoveryCustody(values['--file'], values['--tenant']);
    else if (action === 'check') {
      const value = await loadSyntheticRecoveryCustody(
        values['--file'],
        values['--tenant'],
        values['--custody-id'],
      );
      info = {
        policy: 'synthetic-recovery-custody-info-v1',
        custodyId: value.custodyId,
        tenantSlug: value.tenantSlug,
        createdAt: value.createdAt,
        instances: value.instances,
        protection: 'windows-current-user-dpapi-v1',
      };
    } else fail();
    console.log(JSON.stringify(info));
  } catch {
    console.error(
      'Synthetic recovery custody unavailable. No key was printed or replacement created.',
    );
    process.exitCode = 1;
  }
}
