import { randomUUID } from 'node:crypto';
import {
  validateListingCreationCommand,
  validateListingCreationReceipt,
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
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

// Explicit terminal predecessor facts come from the test, never fabricated here.
export async function seedGuardedListingSuccessor(db, { actorId, ...input }) {
  const command = validateListingSuccessorCommand({ ...input, operationId: randomUUID() });
  const response = await db.query(
    'SELECT app_api.start_listing_revision_v2($1,$2,$3,$4,$5,$6,$7::jsonb) AS receipt',
    [
      command.listingId,
      command.operationId,
      command.expectedListingVersion,
      command.predecessor.revision,
      command.predecessor.version,
      command.predecessor.state,
      JSON.stringify(command.content),
    ],
  );
  const receipt = validateListingSuccessorReceipt(response.rows[0].receipt, command, actorId);
  if (receipt.decision.outcome !== 'applied')
    throw new Error('Synthetic guarded successor refused.');
  return receipt;
}
