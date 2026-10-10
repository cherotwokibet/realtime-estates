// Trusted synthetic process fixture. No network, credentials or provider resources.
import { writeFileSync } from 'node:fs';
writeFileSync('normal.json', JSON.stringify({ arguments: process.argv.slice(3) }), { flag: 'wx' });
process.exit(Number(process.argv[2] ?? '0'));
