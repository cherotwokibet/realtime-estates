const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export type EntryQuery = Record<string, string | string[] | undefined>;
export function enquiryEntryTarget(query: EntryQuery) {
  const keys = Object.keys(query);
  if (!keys.length) return null;
  if (
    keys.some((key) => !['enquiryId', 'viewingId'].includes(key)) ||
    !uuid(query.enquiryId) ||
    (query.viewingId !== undefined && !uuid(query.viewingId))
  )
    throw Error('Invalid enquiry target.');
  return Object.freeze({
    enquiryId: query.enquiryId,
    viewingId: query.viewingId as string | undefined,
  });
}
export function reviewEntryTarget(query: EntryQuery) {
  const keys = Object.keys(query);
  if (!keys.length) return null;
  if (
    keys.length !== 2 ||
    keys.some((key) => !['listingId', 'revision'].includes(key)) ||
    !uuid(query.listingId) ||
    typeof query.revision !== 'string' ||
    !/^[1-9]\d{0,9}$/.test(query.revision) ||
    Number(query.revision) > 2147483647
  )
    throw Error('Invalid review target.');
  return Object.freeze({ listingId: query.listingId, revision: Number(query.revision) });
}
