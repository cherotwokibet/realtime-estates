import { referenceModerationSession } from './reference-moderation-workspace.ts';
import { referenceDraftSession, type ReferenceDraftScope } from './reference-draft-workspace.ts';
import type { SyntheticReferenceAction } from '@realtor/domain';
export type ReferenceTransitionPurpose = 'review' | 'author';
/** Presentation eligibility only. The API/SQL still decide current permissions and completeness. */
export function referenceTransitionActions(
  purpose: ReferenceTransitionPurpose,
  state: string | undefined,
): readonly SyntheticReferenceAction[] {
  return Object.freeze(
    purpose === 'author'
      ? state === 'draft'
        ? ['submit']
        : state === 'pending'
          ? ['withdraw']
          : []
      : purpose === 'review' && state === 'pending'
        ? ['approve', 'reject']
        : [],
  );
}
/** A different saved draft original must be settled in its own recovery workspace first. */
export function assertReferenceAuthorDraftClear(
  store: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  },
  scope: ReferenceDraftScope,
): void {
  if (referenceDraftSession(store, scope).load() !== null)
    throw Error('Finish the retained draft original before a submission or withdrawal.');
}

/** Reciprocally keep draft writes locked while a transition original is retained. Recovery stays separate. */
export function assertReferenceDraftAuthorClear(
  store: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  },
  scope: ReferenceDraftScope,
  revision: number,
): void {
  if (referenceModerationSession(store, { ...scope, revision }, 'author').load() !== null)
    throw Error('Finish the retained submission or withdrawal before editing.');
}
