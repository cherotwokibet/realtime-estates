// Trusted synthetic JS-busy child. Its event loop cannot observe cancellation.
import { writeFileSync } from 'node:fs';
writeFileSync('started.flag', 'synthetic busy loop started', { flag: 'wx' });
for (;;) Math.imul(17, 31);
