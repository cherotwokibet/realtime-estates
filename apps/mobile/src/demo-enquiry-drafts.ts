import { propertiesForCompany, type DemoTenantSlug } from '@realtor/demo';
export type DemoEnquiryKind = 'availability' | 'viewing';
export interface DemoEnquiryDraft {
  readonly id: string;
  readonly listingId: string;
  readonly listingTitle: string;
  readonly kind: DemoEnquiryKind;
  readonly message: string;
  readonly preferredDay: string | null;
  readonly createdAt: string;
}
export interface DemoEnquiryHandle {
  readonly listingTitle: string;
  save(input: { kind: DemoEnquiryKind; message: string; preferredDay: string }): DemoEnquiryDraft;
}
export class DemoDraftError extends Error {}
const fail = (message: string): never => {
  throw new DemoDraftError(message);
};
/** Local preview drafts only. No transport, storage, account, receipt or booking API exists here. */
export function createDemoEnquiryDrafts(slug: DemoTenantSlug, uuid: () => string, now = Date.now) {
  if (!['realtime-estates', 'sample-homes'].includes(slug)) fail('Demo company is unavailable.');
  const listings = propertiesForCompany(slug);
  let drafts: readonly DemoEnquiryDraft[] = Object.freeze([]),
    epoch = 0;
  return Object.freeze({
    snapshot: () => drafts,
    begin(listingId: string): DemoEnquiryHandle {
      const listing = listings.find((row) => row.id === listingId);
      if (!listing) return fail('Choose a property from this demo company.');
      if (drafts.length >= 10)
        return fail('Remove a demo draft from Profile before adding another.');
      const id = uuid(),
        generation = epoch;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ||
        drafts.some((row) => row.id === id)
      )
        return fail('A new local draft could not be prepared.');
      let original: DemoEnquiryDraft | undefined;
      return Object.freeze({
        listingTitle: listing.title,
        save(input: { kind: DemoEnquiryKind; message: string; preferredDay: string }) {
          if (generation !== epoch) return fail('This draft was cleared. Open a new draft.');
          if (
            !input ||
            Object.getPrototypeOf(input) !== Object.prototype ||
            Reflect.ownKeys(input).length !== 3
          )
            return fail('Check the demo draft fields.');
          const descriptors = Object.getOwnPropertyDescriptors(input);
          for (const key of ['kind', 'message', 'preferredDay'])
            if (!descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'))
              return fail('Check the demo draft fields.');
          const { kind, message, preferredDay } = input;
          if (
            !['availability', 'viewing'].includes(kind) ||
            typeof message !== 'string' ||
            !message.trim() ||
            message.length > 1000 ||
            /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message) ||
            /[\ud800-\udfff]/u.test(message) ||
            typeof preferredDay !== 'string'
          )
            return fail('Choose an enquiry type and enter a message of up to1000 characters.');
          const body = {
            kind,
            message: message.trim(),
            preferredDay: kind === 'viewing' ? preferredDay : null,
          };
          if (original) {
            if (
              original.kind !== body.kind ||
              original.message !== body.message ||
              original.preferredDay !== body.preferredDay
            )
              return fail('This local draft was already saved. Prepare a new draft for changes.');
            return original;
          }
          const instant = now();
          if (
            !Number.isSafeInteger(instant) ||
            !Number.isFinite(new Date(instant + 10800000).getTime())
          )
            return fail('The local clock is unavailable.');
          const today = new Date(instant + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (kind === 'viewing') {
            const date = new Date(preferredDay + 'T00:00:00.000Z');
            if (
              !/^\d{4}-\d{2}-\d{2}$/.test(preferredDay) ||
              !Number.isFinite(date.getTime()) ||
              date.toISOString().slice(0, 10) !== preferredDay ||
              preferredDay < today
            )
              return fail(
                'Use a valid preferred day, today or later, in YYYY-MM-DD format (Nairobi).',
              );
          } else if (preferredDay !== '')
            return fail('Availability drafts do not select a viewing day.');
          if (drafts.length >= 10)
            return fail('Remove a demo draft from Profile before adding another.');
          if (drafts.some((row) => row.id === id))
            return fail('A new local draft could not be saved.');
          original = Object.freeze({
            id,
            listingId,
            listingTitle: listing.title,
            ...body,
            createdAt: new Date(instant).toISOString(),
          });
          drafts = Object.freeze([...drafts, original]);
          return original;
        },
      });
    },
    remove(id: string) {
      drafts = Object.freeze(drafts.filter((row) => row.id !== id));
      epoch++;
    },
    clear() {
      drafts = Object.freeze([]);
      epoch++;
    },
  });
}
