import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Disposable compatibility simulation only. Not a migration/deployment runner.
// Default reviewed migrations remain unchanged; callers cannot choose source paths.
export const referenceCandidateFiles = Object.freeze([
  'listing-reference-draft.sql',
  'listing-reference-catalogue-install.sql',
  'listing-reference-read.sql',
  'listing-reference-moderation.sql',
  'listing-reference-creation.sql',
  'listing-reference-successor.sql',
]);
export async function prepareReferenceCandidate() {
  const sources = [];
  for (const file of referenceCandidateFiles) {
    const original = await readFile(new URL('../proposals/' + file, import.meta.url), 'utf8');
    if (
      (original.match(/^BEGIN;\r?$/gm) ?? []).length !== 1 ||
      (original.match(/^COMMIT;\r?$/gm) ?? []).length !== 1 ||
      !/^COMMIT;\s*$/.test(original.slice(original.lastIndexOf('COMMIT;')))
    )
      throw Error('Candidate transaction framing changed.');
    const sql = original.replace(/^BEGIN;\r?\n/m, '').replace(/^COMMIT;\s*$/m, '');
    sources.push(
      Object.freeze({ file, sha256: createHash('sha256').update(original).digest('hex'), sql }),
    );
  }
  return Object.freeze(sources);
}
/** All reviewed candidate bodies commit together, or every DDL/ACL change rolls back. */
export async function applyReferenceCandidate(database) {
  const sources = await prepareReferenceCandidate();
  await database.exec('BEGIN;');
  try {
    const existing = (
      await database.query(
        "SELECT to_regclass('app_private.synthetic_reference_catalogues') AS catalogue, to_regprocedure('app_api.save_synthetic_reference_draft(uuid,integer,bigint,uuid,jsonb,jsonb)') AS command, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app_private' AND table_name='listing_revisions' AND column_name='synthetic_reference_attributes') AS column_present",
      )
    ).rows[0];
    if (existing.catalogue !== null || existing.command !== null || existing.column_present)
      throw Error('Candidate requires an unadopted default schema.');
    for (const source of sources)
      await database.exec('-- reference-candidate: ' + source.file + '\n' + source.sql);
    await database.exec('COMMIT;');
    return Object.freeze(sources.map(({ file, sha256 }) => Object.freeze({ file, sha256 })));
  } catch (error) {
    await database.exec('ROLLBACK;');
    throw error;
  }
}
