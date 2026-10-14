import { readFile } from 'node:fs/promises';

// Explicit reviewed order for disposable test databases; this is not a deployment runner.
const files = ['0001_foundation.sql', '0002_listing_disclosure.sql', '0003_registered_media_jobs.sql', '0004_media_processing.sql', '0005_media_upload_context.sql', '0006_media_attachment.sql', '0007_media_gallery_commands.sql', '0008_media_upload_preflight.sql', '0009_media_preview.sql', '0010_enquiry_operations.sql', '0011_enquiry_activity.sql', '0012_enquiry_contacts.sql', '0013_viewing_scheduling.sql', '0014_viewing_confirmation.sql', '0015_viewing_termination.sql', '0016_viewing_history.sql'];
export async function applyTestMigrations(database) {
  for (const file of files) {
    await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
}
