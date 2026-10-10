// Trusted synthetic third level, kept inside the native job without inherited pipes.
import { appendFileSync, writeFileSync } from 'node:fs';
writeFileSync('grandchild-started.flag', 'owned grandchild started', { flag: 'wx' });
setInterval(() => appendFileSync('heartbeat.txt', 'x'), 25);
