// Trusted synthetic hanging child; the owned native job must terminate it.
import { writeFileSync } from 'node:fs';
writeFileSync('started.flag', 'synthetic hang started', { flag: 'wx' });
setInterval(() => {}, 1000);
