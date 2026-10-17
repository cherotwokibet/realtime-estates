import { DomainError } from './errors.js';
export interface ReviewMediaGallery {
  readonly kind: 'review_media_gallery';
  readonly listingId: string;
  readonly revision: number;
  readonly version: string;
  readonly state: 'pending';
  readonly photos: readonly Readonly<{ id: string; alt: string; position: number }>[];
}
function invalid(): never {
  throw new DomainError('INVALID_REVIEW_GALLERY', 'Invalid reviewer gallery.');
}
function record(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    return invalid();
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    out[key] = d.value;
  }
  return out;
}
function uuid(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
  )
    return invalid();
  return input.toLowerCase();
}
export function validateReviewMediaGallery(
  input: unknown,
  listingId: string,
  revision: number,
  version: string,
): ReviewMediaGallery {
  const listing = uuid(listingId);
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > 2147483647 ||
    typeof version !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(version) ||
    BigInt(version) > 9007199254740991n
  )
    return invalid();
  const row = record(input, ['kind', 'listingId', 'revision', 'version', 'state', 'photos']);
  if (
    row.kind !== 'review_media_gallery' ||
    row.state !== 'pending' ||
    uuid(row.listingId) !== listing ||
    row.revision !== revision ||
    row.version !== version
  )
    return invalid();
  if (
    !Array.isArray(row.photos) ||
    Object.getPrototypeOf(row.photos) !== Array.prototype ||
    row.photos.length < 4 ||
    row.photos.length > 12 ||
    Reflect.ownKeys(row.photos).length !== row.photos.length + 1
  )
    return invalid();
  const ids = new Set<string>();
  let previous = -1;
  const photos = Array.from({ length: row.photos.length }, (_, index) => {
    const d = Object.getOwnPropertyDescriptor(row.photos, String(index));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    const p = record(d.value, ['id', 'alt', 'position']),
      id = uuid(p.id);
    if (
      ids.has(id) ||
      typeof p.alt !== 'string' ||
      p.alt.length > 600 ||
      Array.from(p.alt).length > 300 ||
      /[\uD800-\uDFFF]/u.test(p.alt) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(p.alt) ||
      typeof p.position !== 'number' ||
      !Number.isInteger(p.position) ||
      p.position < 0 ||
      p.position > 11 ||
      p.position <= previous
    )
      return invalid();
    ids.add(id);
    previous = p.position;
    return Object.freeze({ id, alt: p.alt, position: p.position });
  });
  return Object.freeze({
    kind: 'review_media_gallery',
    listingId: listing,
    revision,
    version,
    state: 'pending',
    photos: Object.freeze(photos),
  });
}
