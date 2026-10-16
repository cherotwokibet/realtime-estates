import { readFile } from 'node:fs/promises';

// Explicit reviewed order for disposable test databases; this is not a deployment runner.
const files = [
  '0001_foundation.sql',
  '0002_listing_disclosure.sql',
  '0003_registered_media_jobs.sql',
  '0004_media_processing.sql',
  '0005_media_upload_context.sql',
  '0006_media_attachment.sql',
  '0007_media_gallery_commands.sql',
  '0008_media_upload_preflight.sql',
  '0009_media_preview.sql',
  '0010_enquiry_operations.sql',
  '0011_enquiry_activity.sql',
  '0012_enquiry_contacts.sql',
  '0013_viewing_scheduling.sql',
  '0014_viewing_confirmation.sql',
  '0015_viewing_termination.sql',
  '0016_viewing_history.sql',
  '0017_viewing_rescheduling.sql',
  '0018_viewing_outcomes.sql',
  '0019_viewing_reminder_suppression.sql',
  '0020_viewing_reminder_admission.sql',
  '0021_viewing_reminder_capture.sql',
  '0022_listing_creation.sql',
  '0023_listing_successor.sql',
  '0024_guarded_draft_allocation.sql',
  '0025_listing_controls.sql',
  '0026_review_media_preview.sql',
];
export async function applyTestMigrations(database, { after, through } = {}) {
  // Historical migration fixtures can continue through the reviewed current order.
  // Only a listed filename is accepted; never interpolate an arbitrary input path.
  const offset = after === undefined ? 0 : files.indexOf(after) + 1;
  if (after !== undefined && offset === 0)
    throw new Error('Unknown historical migration boundary.');
  const end = through === undefined ? files.length : files.indexOf(through) + 1;
  if (end === 0 || end < offset) throw new Error('Invalid historical migration range.');
  for (const file of files.slice(offset, end)) {
    await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
}
