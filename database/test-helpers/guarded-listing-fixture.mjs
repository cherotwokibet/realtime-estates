import { randomUUID } from 'node:crypto';
import {
  validateListingCreationCommand,
  validateListingCreationReceipt,
} from '../../packages/domain/dist/index.js';

// Caller supplies an already authorized staff transaction; no privileged bypass.
export async function seedGuardedListingDraft(db, { listingId, slug, content, actorId }) {
  const command = validateListingCreationCommand({
    listingId,
    operationId: randomUUID(),
    slug,
    content,
  });
  const response = await db.query(
    'SELECT app_api.create_listing_draft_v2($1,$2,$3,$4::jsonb) AS receipt',
    [command.listingId, command.operationId, command.slug, JSON.stringify(command.content)],
  );
  const receipt = validateListingCreationReceipt(response.rows[0].receipt, command, actorId);
  if (receipt.outcome !== 'created') throw new Error('Synthetic guarded listing creation refused.');
  return receipt;
}
