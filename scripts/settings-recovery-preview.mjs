/** Explicit owned loopback settings rehearsal. No production/provider or existing-owner database. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  marker,
  startRecoveryLedgerFixture,
  ownedLedgerRoot,
} from '../apps/api/dev/recovery-ledger-preview.mjs';
import { createSyntheticRecoveryCustody } from './private-recovery-custody.mjs';
import { syntheticRecoveryLaunchEnvironment } from './synthetic-recovery-launch.mjs';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const mode = {
  NODE_ENV: 'development',
  PRIVATE_RECOVERY_CUSTODY_MODE: 'synthetic-windows-owner-v1',
};
const fail = () => {
  throw Error('Owned settings recovery preview unavailable.');
};
export async function initializeOwnedSettingsRecovery(custodyOptions) {
  if (process.env.NODE_ENV === 'production') fail();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'realtor-ledger490-')));
  await writeFile(join(root, 'owner.txt'), marker, { flag: 'wx' });
  const file = join(root, 'custody.json'),
    info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode, custodyOptions);
  return Object.freeze({ root, file, custodyId: info.custodyId });
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit');
  child.kill();
  let timer;
  try {
    await Promise.race([
      done,
      new Promise((r) => {
        timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          r();
        }, 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function startSettingsRecoveryPreview(options) {
  if (
    process.env.NODE_ENV === 'production' ||
    options?.policy !== 'owned-settings-rehearsal-v1' ||
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535
  )
    fail();
  await ownedLedgerRoot(options.root);
  let fixture,
    child,
    closed = false,
    queue = Promise.resolve();
  const origin = 'http://127.0.0.1:' + options.port;
  async function stop() {
    try {
      await stopChild(child);
    } finally {
      child = null;
      const active = fixture;
      fixture = null;
      await active?.close();
    }
  }
  async function launch(initialize, controls = {}) {
    await stop();
    const custody = await syntheticRecoveryLaunchEnvironment(
      {
        ...mode,
        PRIVATE_RECOVERY_CUSTODY_FILE: options.file,
        PRIVATE_RECOVERY_CUSTODY_ID: options.custodyId,
      },
      'realtime-estates',
      options.custodyOptions,
    );
    fixture = await startRecoveryLedgerFixture({
      root: options.root,
      initialize,
      corruptFirstReply: initialize && options.loseFirstReply === true,
      ...controls,
    });
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !/^(?:STAFF_|WEB_|PRIVATE_RECOVERY_|API_ORIGIN$|ALLOW_LOOPBACK_API$)/i.test(k),
      ),
    );
    child = spawn(
      process.execPath,
      [
        join(sourceRoot, 'node_modules/next/dist/bin/next'),
        'start',
        '-p',
        String(options.port),
        '-H',
        '127.0.0.1',
      ],
      {
        cwd: join(sourceRoot, 'apps/admin'),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...inherited,
          NODE_ENV: 'development',
          NEXT_TELEMETRY_DISABLED: '1',
          TENANT_SLUG: 'realtime-estates',
          STAFF_PREVIEW_MODE: 'synthetic',
          STAFF_PREVIEW_API_ORIGIN: fixture.origin,
          STAFF_PREVIEW_TOKEN: fixture.bearerToken,
          STAFF_PREVIEW_INSTANCE: custody.instances.staff,
          ...custody.environment,
        },
      },
    );
    // Consume logs without printing runtime environment, keys, bearer or private page data.
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    let spawnFailure = false;
    child.once('error', () => {
      spawnFailure = true;
    });
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnFailure || child.exitCode !== null) break;
      try {
        const response = await fetch(origin + '/settings', { signal: AbortSignal.timeout(3000) });
        if (response.status === 200) {
          await response.body?.cancel();
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) {
      await stop();
      fail();
    }
    return Object.freeze({
      origin,
      instanceId: custody.instances.staff,
      signingFingerprint: fixture.signingFingerprint,
      nextPid: child.pid,
    });
  }
  let current;
  try {
    current = await launch(
      options.initialize === true,
      options.membershipRole === undefined ? {} : { membershipRole: options.membershipRole },
    );
  } catch (e) {
    await stop();
    throw e;
  }
  return Object.freeze({
    get current() {
      return current;
    },
    inspect: () => fixture?.inspect(),
    writes: () => fixture?.writeRequests(),
    restart(controls = {}) {
      if (
        !controls ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(controls)) ||
        Reflect.ownKeys(controls).some((k) => k !== 'membershipRole')
      )
        return Promise.reject(Error('Unsupported owned rehearsal control.'));
      const role = Object.getOwnPropertyDescriptor(controls, 'membershipRole');
      if (
        role &&
        (!Object.hasOwn(role, 'value') ||
          !role.enumerable ||
          !['admin', 'agent'].includes(role.value))
      )
        return Promise.reject(Error('Unsupported owned rehearsal control.'));
      controls = role ? { membershipRole: role.value } : {};
      if (closed) return Promise.reject(Error('Rehearsal closed.'));
      queue = queue.then(async () => {
        if (closed) fail();
        current = await launch(false, controls);
        return current;
      });
      return queue;
    },
    async close() {
      closed = true;
      await queue.catch(() => {});
      await stop();
    },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let preview, input;
  const interrupt = () => {
    input?.close();
    void preview?.close().finally(() => process.exit(130));
  };
  try {
    const args = process.argv.slice(2),
      flags = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (
        !['--mode', '--root', '--file', '--custody-id', '--port', '--initialize'].includes(
          args[i],
        ) ||
        flags.has(args[i]) ||
        typeof args[i + 1] !== 'string'
      )
        fail();
      flags.set(args[i], args[i + 1]);
    }
    if (flags.get('--mode') !== 'owned-settings-rehearsal-v1') fail();
    const initialize = flags.get('--initialize');
    if (initialize !== undefined && initialize !== 'new-disposable-v1') fail();
    let bundle;
    if (initialize) {
      if (['--root', '--file', '--custody-id'].some((k) => flags.has(k))) fail();
      bundle = await initializeOwnedSettingsRecovery();
    } else
      bundle = {
        root: flags.get('--root'),
        file: flags.get('--file'),
        custodyId: flags.get('--custody-id'),
      };
    preview = await startSettingsRecoveryPreview({
      ...bundle,
      policy: 'owned-settings-rehearsal-v1',
      port: Number(flags.get('--port') ?? '3001'),
      initialize: !!initialize,
    });
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    console.log(
      JSON.stringify({
        policy: 'owned-settings-rehearsal-v1',
        ...bundle,
        origin: preview.current.origin,
      }),
    );
    input = createInterface({ input: process.stdin });
    for await (const line of input) {
      if (line === 'restart') {
        await preview.restart();
        console.log('Owned settings preview restarted with fresh signed authority.');
      } else if (line === 'stop') break;
      else console.log('Available commands: restart, stop.');
    }
  } catch {
    console.error(
      'Owned settings recovery preview unavailable. No replacement ledger was created.',
    );
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    input?.close();
    await preview?.close();
  }
}
