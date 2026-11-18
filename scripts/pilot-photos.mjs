import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticGalleryPng } from '../packages/media/tests/fixtures.mjs';

const directory = await mkdtemp(join(tmpdir(), 'realtor-pilot-photos-'));
for (let index = 0; index < 4; index++) {
  const file = join(directory, `synthetic-gallery-${index + 1}.png`);
  await writeFile(file, syntheticGalleryPng(index), { flag: 'wx' });
}
console.log(directory);
