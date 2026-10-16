// Trusted synthetic descendant. Windows detached mode prevents libuv's own child
// cleanup from hiding the native-job proof. No breakaway or PID-based targeting.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const grandchild = spawn(
  process.execPath,
  [fileURLToPath(new URL('./tree-grandchild.mjs', import.meta.url))],
  {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    detached: true,
  },
);
grandchild.once('error', () => process.exit(4));
let announced = false;
setInterval(() => {
  if (!announced && existsSync('grandchild-started.flag')) {
    writeFileSync('descendant-started.flag', 'owned child and grandchild started', { flag: 'wx' });
    announced = true;
  }
}, 10);
