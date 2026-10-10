import { readFile } from 'node:fs/promises';

// Explicit reviewed order for disposable test databases; this is not a deployment runner.
const files = ['0001_foundation.sql', '0002_listing_disclosure.sql'];
export async function applyTestMigrations(database) {
  for (const file of files) {
    await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
}
