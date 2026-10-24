import { formToDraft, type DraftForm } from './editor-model.ts';
import { buildReferenceDraftCommand } from './reference-draft-workspace.ts';
import type { ListingReferenceCatalogue, ListingReferenceSelection } from '@realtor/domain';
/** One validated original contains both property edits and explicitly selected reference facts. */
export function referenceFormCommand(
  form: DraftForm,
  selection: ListingReferenceSelection,
  catalogue: ListingReferenceCatalogue,
  target: { operationId: string; listingId: string; revision: number; expectedVersion: string },
) {
  return buildReferenceDraftCommand(
    { ...target, content: formToDraft(form), selection },
    catalogue,
  );
}
