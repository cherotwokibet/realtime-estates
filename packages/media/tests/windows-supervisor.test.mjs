import assert from 'node:assert/strict';
import { copyFile, lstat, mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createWindowsSyntheticSupervisor,
  parseWindowsSyntheticTerminal,
  WindowsSupervisorError,
} from '../dist/windows-supervisor.js';

// Only these authored synthetic scripts are launched. The adapter/native helper own
// their process handles/jobs. Tests never taskkill, discover or signal arbitrary PIDs.
// They are Windows-specific lifetime evidence, not a production isolation claim.
const WINDOWS_ONLY = { skip: process.platform !== 'win32', timeout: 90_000 };
const POWER_SHELL =
  process.env.REALTOR_TEST_POWERSHELL ??
  path.join(
    os.homedir(),
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'native',
    'powershell',
    'pwsh.exe',
  );
const fixturePath = (name) =>
  fileURLToPath(new URL(`./process-fixtures/${name}.mjs`, import.meta.url));
const hasCode = (code) => (error) => error instanceof WindowsSupervisorError && error.code === code;
const terminal = (overrides) =>
  JSON.stringify({
    state: 'exited',
    termination: 'job_empty',
    exitCode: 0,
    activeProcesses: 0,
    safeCode: 'EXITED',
    ...overrides,
  }) + '\n';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let unexpectedContainmentUnknown = false;

async function exists(location) {
  try {
    await lstat(location);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function environment(t) {
  assert.equal(
    unexpectedContainmentUnknown,
    false,
    'A prior unexpected unknown outcome blocks further native fixture launches',
  );
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor supervisor tests '));
  const supervisor = await createWindowsSyntheticSupervisor({
    powerShellPath: POWER_SHELL,
    attemptParent: parent,
  });
  const attempts = new Map();
  const ownedRuns = new Set();
  t.after(async () => {
    // A marker/assertion failure must not advance to another native test while this
    // helper's owned job still runs toward its native/overall deadline.
    await Promise.allSettled([...ownedRuns]);
    let retained = false;
    for (const [directory, status] of attempts) {
      if (!status.cleanupAllowed) {
        retained = true;
        t.diagnostic(`Unconfirmed synthetic attempt retained: ${directory}`);
        continue;
      }
      assert.equal(path.dirname(directory), parent);
      const stat = await lstat(directory);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      for (const name of await readdir(directory)) {
        const location = path.join(directory, name);
        const file = await lstat(location);
        assert.ok(file.isFile() && !file.isSymbolicLink());
        await unlink(location);
      }
      await rmdir(directory); // Never recursive and never before an empty-job barrier.
    }
    if (!retained) await rmdir(parent);
  });
  async function attempt() {
    const directory = await mkdtemp(path.join(parent, 'owned attempt '));
    attempts.set(directory, { cleanupAllowed: true }); // No launch has happened yet.
    return directory;
  }
  async function run(
    directory,
    script,
    overrides = {},
    options = {},
    selectedSupervisor = supervisor,
    expectedUnknown = false,
  ) {
    const status = attempts.get(directory);
    status.cleanupAllowed = false;
    const running = selectedSupervisor.run(
      {
        executablePath: process.execPath,
        arguments: [fixturePath(script)],
        workingDirectory: directory,
        timeoutMs: 5000,
        ...overrides,
      },
      options,
    );
    ownedRuns.add(running);
    try {
      const result = await running;
      status.cleanupAllowed = result.termination === 'job_empty';
      if (!status.cleanupAllowed && !expectedUnknown) unexpectedContainmentUnknown = true;
      return result;
    } catch (error) {
      unexpectedContainmentUnknown = true;
      throw error;
    } finally {
      ownedRuns.delete(running);
    }
  }
  return { parent, supervisor, attempt, run };
}

async function waitForMarker(marker, running) {
  let finished;
  running.then(
    (result) => {
      finished = result;
    },
    (error) => {
      finished = error;
    },
  );
  const deadline = performance.now() + 15_000;
  while (!(await exists(marker))) {
    if (finished)
      throw new Error(`Synthetic fixture finished before marker: ${JSON.stringify(finished)}`);
    if (performance.now() > deadline) throw new Error('Synthetic fixture marker deadline expired');
    await delay(20);
  }
}

test('strict protocol preserves only a confirmed native zero-membership receipt', () => {
  assert.deepEqual(parseWindowsSyntheticTerminal(terminal()), {
    state: 'exited',
    termination: 'job_empty',
    exitCode: 0,
    activeProcesses: 0,
    safeCode: 'EXITED',
  });
  const result = parseWindowsSyntheticTerminal(
    terminal({ state: 'failed', exitCode: null, safeCode: 'PROCESS_CREATE_FAILED' }),
  );
  assert.equal(result.termination, 'job_empty');
  assert.equal(result.exitCode, null);
  const maximum = parseWindowsSyntheticTerminal(terminal({ exitCode: 0xffffffff }));
  assert.equal(maximum.exitCode, 0xffffffff);
});

test('close-like, malformed and contradictory protocol cannot certify an empty job', () => {
  for (const input of [
    '',
    '0',
    '{}',
    '[]',
    terminal({ activeProcesses: 1 }),
    terminal({ exitCode: null }),
    terminal({ exitCode: -1 }),
    terminal({ exitCode: 0x100000000 }),
    terminal({ termination: 'unconfirmed' }),
    terminal({ unexpected: true }),
    terminal() + terminal(),
    terminal({ safeCode: 'path: or detail' }),
  ]) {
    const result = parseWindowsSyntheticTerminal(input);
    assert.equal(result.state, 'containment_unknown');
    assert.equal(result.termination, 'unconfirmed');
    assert.equal(result.cleanupAllowed, false);
    assert.equal(Object.hasOwn(result, 'exitCode'), false);
    assert.equal(Object.hasOwn(result, 'activeProcesses'), false);
  }
});

test('duplicate decoded keys and noncanonical numeric tokens fail before rounded interpretation', () => {
  for (const input of [
    terminal().replace('"exitCode":0', '"exitCode":0,"exitCode":0'),
    terminal().replace('"exitCode":0', '"exitCode":0,"exit\\u0043ode":0'),
    terminal().replace('"exitCode":0', '"exitCode":0e0'),
    terminal().replace('"activeProcesses":0', '"activeProcesses":0.0000000000000000001'),
    terminal().replace('"activeProcesses":0', '"activeProcesses":0.0'),
  ])
    assert.equal(parseWindowsSyntheticTerminal(input).termination, 'unconfirmed');
});

test('bounded protocol rejects oversized data and omits unknown native accounting facts', () => {
  assert.equal(parseWindowsSyntheticTerminal(' '.repeat(8193)).termination, 'unconfirmed');
  const result = parseWindowsSyntheticTerminal(
    terminal({
      state: 'containment_unknown',
      termination: 'unconfirmed',
      activeProcesses: 3,
      exitCode: 5,
      safeCode: 'TERMINATION_UNCONFIRMED',
    }),
  );
  assert.deepEqual(result, {
    state: 'containment_unknown',
    termination: 'unconfirmed',
    cleanupAllowed: false,
    safeCode: 'TERMINATION_UNCONFIRMED',
  });
  assert.ok(Object.isFrozen(result));
});

test(
  'normal and nonzero direct exits both require actual native empty-job barriers',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    for (const exitCode of [0, 17]) {
      const directory = await e.attempt();
      const result = await e.run(directory, 'normal', {
        arguments: [fixturePath('normal'), String(exitCode)],
      });
      assert.deepEqual(result, {
        state: 'exited',
        termination: 'job_empty',
        activeProcesses: 0,
        exitCode,
        safeCode: 'EXITED',
      });
      assert.ok(Object.isFrozen(result));
      assert.equal(await exists(path.join(directory, 'normal.json')), true);
    }
  },
);

test(
  'hanging and JS-busy children are terminated by deadline before zero-count receipts',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    for (const script of ['hang', 'busy']) {
      const directory = await e.attempt();
      const result = await e.run(directory, script, { timeoutMs: 1200 });
      assert.equal(result.state, 'timed_out');
      assert.equal(result.safeCode, 'WALL_TIMEOUT');
      assert.equal(result.termination, 'job_empty');
      assert.equal(result.activeProcesses, 0);
      assert.equal(await exists(path.join(directory, 'started.flag')), true);
    }
  },
);

test(
  'explicit cancellation and BUSY admission settle one job and permit only a fresh next attempt',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    const directory = await e.attempt();
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const running = e.run(directory, 'hang', { timeoutMs: 10_000 }, options);
    options.signal = {}; // Later caller mutation must not alter captured native signal.
    await waitForMarker(path.join(directory, 'started.flag'), running);
    await assert.rejects(
      e.supervisor.run({
        executablePath: process.execPath,
        arguments: [fixturePath('normal')],
        workingDirectory: directory,
        timeoutMs: 1000,
      }),
      hasCode('BUSY'),
    );
    controller.abort();
    controller.abort();
    const result = await running;
    assert.equal(result.state, 'cancelled');
    assert.equal(result.termination, 'job_empty');
    assert.equal(result.activeProcesses, 0);
    await assert.rejects(
      e.supervisor.run({
        executablePath: process.execPath,
        arguments: [fixturePath('normal')],
        workingDirectory: directory,
        timeoutMs: 1000,
      }),
      hasCode('REUSED_ATTEMPT'),
    );
    const fresh = await e.attempt();
    assert.equal((await e.run(fresh, 'normal')).termination, 'job_empty');
  },
);

test(
  'parent exit with live child and grandchild plus closed pipes is detected and drained by owned job accounting',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    const directory = await e.attempt();
    const result = await e.run(directory, 'tree-parent', { maxProcesses: 4 });
    assert.equal(result.state, 'failed');
    assert.equal(result.safeCode, 'DESCENDANTS_REMAINED');
    assert.equal(result.termination, 'job_empty');
    assert.equal(result.activeProcesses, 0);
    assert.equal(await exists(path.join(directory, 'parent-exited.flag')), true);
    assert.equal(await exists(path.join(directory, 'descendant-started.flag')), true);
    assert.equal(await exists(path.join(directory, 'grandchild-started.flag')), true);
    const heartbeat = path.join(directory, 'heartbeat.txt');
    const before = (await exists(heartbeat)) ? await readFile(heartbeat) : Buffer.alloc(0);
    await delay(150);
    const after = (await exists(heartbeat)) ? await readFile(heartbeat) : Buffer.alloc(0);
    assert.deepEqual(after, before);
  },
);

test(
  'minimal child environment strips preload/credential sentinels and Windows quoting preserves data',
  WINDOWS_ONLY,
  async (t) => {
    const names = [
      'REALTOR_SYNTHETIC_SECRET_SENTINEL',
      'NODE_OPTIONS',
      'NODE_PATH',
      'DATABASE_URL',
      'AWS_SECRET_ACCESS_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'USERPROFILE',
      'HOMEDRIVE',
      'HOMEPATH',
      'LOGONSERVER',
      'SYSTEMDRIVE',
      'USERDOMAIN',
      'USERNAME',
    ];
    const prior = new Map(names.map((name) => [name, process.env[name]]));
    for (const name of names)
      process.env[name] =
        name === 'NODE_OPTIONS'
          ? '--invalid-synthetic-preload-if-forwarded'
          : 'synthetic-not-a-real-secret';
    try {
      const e = await environment(t);
      const directory = await e.attempt();
      const values = [
        'two words',
        'quote " inside',
        'trailing\\',
        'mix\\\\"quote',
        '& | <> $() ; `',
        'Kenya nyumba',
      ];
      const result = await e.run(directory, 'environment', {
        arguments: [fixturePath('environment'), ...values],
      });
      assert.equal(result.state, 'exited');
      assert.equal(result.exitCode, 0);
      assert.equal(result.termination, 'job_empty');
      const snapshot = JSON.parse(await readFile(path.join(directory, 'environment.json'), 'utf8'));
      assert.deepEqual(snapshot.present, Object.fromEntries(names.map((name) => [name, false])));
      assert.deepEqual(snapshot.unexpectedNames, []);
      assert.equal(snapshot.tempMatchesAttempt, true);
      assert.equal(snapshot.tmpMatchesAttempt, true);
      assert.equal(snapshot.uvThreads, '1');
      assert.deepEqual(snapshot.arguments, values);
    } finally {
      for (const [name, value] of prior) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  },
);

test(
  'invalid signal/configuration never launches and does not consume a fresh attempt',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    const directory = await e.attempt();
    const request = {
      executablePath: process.execPath,
      arguments: [fixturePath('normal')],
      workingDirectory: directory,
      timeoutMs: 2000,
    };
    for (const signal of [{}, Object.create(AbortSignal.prototype), null, 'not a signal']) {
      await assert.rejects(e.supervisor.run(request, { signal }), hasCode('INVALID_CONFIGURATION'));
      assert.deepEqual(await readdir(directory), []);
    }
    for (const overrides of [
      { timeoutMs: 0 },
      { timeoutMs: 1.1 },
      { maxProcesses: 2 },
      { arguments: ['-e', 'throw 0'] },
      { workingDirectory: e.parent },
    ]) {
      await assert.rejects(
        e.supervisor.run({ ...request, ...overrides }),
        hasCode('INVALID_CONFIGURATION'),
      );
    }
    const result = await e.run(directory, 'normal');
    assert.equal(result.state, 'exited');
    assert.equal(result.termination, 'job_empty');
  },
);

test(
  'misconfigured owned supervisor close without a native receipt remains unknown and blocks the instance',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    const tooling = await mkdtemp(
      path.join(os.tmpdir(), 'realtor supervisor missing-receipt tools '),
    );
    const misconfigured = path.join(tooling, 'pwsh.exe');
    // Root-approved failure fixture: a COPY of this trusted Node binary rejects fixed
    // PowerShell flags before executing JS. This is NOT a native supervisor crash test.
    await copyFile(process.execPath, misconfigured);
    const supervisor = await createWindowsSyntheticSupervisor({
      powerShellPath: misconfigured,
      attemptParent: e.parent,
    });
    const directory = await e.attempt();
    const result = await e.run(directory, 'normal', {}, {}, supervisor, true);
    assert.equal(result.state, 'containment_unknown');
    assert.equal(result.termination, 'unconfirmed');
    assert.equal(result.cleanupAllowed, false);
    assert.equal(Object.hasOwn(result, 'exitCode'), false);
    assert.equal(Object.hasOwn(result, 'activeProcesses'), false);
    assert.deepEqual(await readdir(directory), []);
    const fresh = await e.attempt();
    await assert.rejects(
      supervisor.run({
        executablePath: process.execPath,
        arguments: [fixturePath('normal')],
        workingDirectory: fresh,
        timeoutMs: 1000,
      }),
      hasCode('CONTAINMENT_BLOCKED'),
    );
    assert.deepEqual(await readdir(fresh), []);
    // No automatic deletion under an unknown outcome. Retain the owned attempt and
    // copied tooling for explicit inspection/recovery; no arbitrary process is killed.
    t.diagnostic(`Missing-receipt fixture tooling retained: ${tooling}`);
  },
);
