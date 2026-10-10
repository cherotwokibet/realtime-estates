// Trusted three-level fixture. Windows detached mode bypasses Node/libuv's own global
// kill-on-close child job; it does NOT set CREATE_BREAKAWAY_FROM_JOB. Both levels must
// remain in the native supervisor's non-breakaway job after this parent exits.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const child = spawn(process.execPath, [fileURLToPath(new URL('./tree-child.mjs', import.meta.url))], {
  cwd: process.cwd(), stdio: 'ignore', windowsHide: true, shell: false, detached: true,
});
child.once('error', () => process.exit(3));
setInterval(() => {
  if (existsSync('descendant-started.flag')) {
    writeFileSync('parent-exited.flag', 'parent exits while descendant stays alive', { flag: 'wx' });
    process.exit(0);
  }
}, 10);
