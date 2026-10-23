import { DomainError } from './errors.js';
import { PROPERTY_TYPES, type PropertyType } from './property.js';
export interface ReferenceLocation {
  readonly id: string;
  readonly kind: 'county' | 'locality' | 'neighbourhood';
  readonly parentId: string | null;
  readonly label: string;
}
export interface ReferenceAmenity {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly propertyTypes: readonly PropertyType[];
}
export interface ListingReferenceCatalogue {
  readonly policy: 'synthetic-reference-catalogue-v1';
  readonly version: string;
  readonly country: 'KE';
  readonly locations: readonly ReferenceLocation[];
  readonly amenities: readonly ReferenceAmenity[];
}
export interface ListingReferenceSelection {
  readonly catalogueVersion: string;
  readonly location: Readonly<{
    countyId: string | null;
    localityId: string | null;
    neighbourhoodId: string | null;
  }>;
  readonly amenityIds: readonly string[];
}
type ErrorCode =
  'INVALID_REFERENCE_CATALOGUE' | 'INVALID_REFERENCE_SELECTION' | 'STALE_REFERENCE_CATALOGUE';
function fail(code: ErrorCode): never {
  throw new DomainError(code, 'Invalid or outdated synthetic listing reference facts.');
}
function own(input: unknown, fields: readonly string[], code: ErrorCode): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail(code);
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return fail(code);
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(input, field);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail(code);
    result[field] = d.value;
  }
  return result;
}
function array(input: unknown, maximum: number, code: ErrorCode): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return fail(code);
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (
    !Number.isInteger(length) ||
    length < 0 ||
    length > maximum ||
    Reflect.ownKeys(input).length !== length + 1
  )
    return fail(code);
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail(code);
    result.push(d.value);
  }
  return result;
}
function uuid(input: unknown, code: ErrorCode): string {
  if (
    typeof input !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input)
  )
    return fail(code);
  return input;
}
function version(input: unknown, code: ErrorCode): string {
  if (
    typeof input !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(input) ||
    BigInt(input) > 9007199254740991n
  )
    return fail(code);
  return input;
}
function label(input: unknown, code: ErrorCode): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 320) return fail(code);
  const characters = [...input];
  if (
    input !== input.trim() ||
    input.normalize('NFC') !== input ||
    characters.length > 160 ||
    characters.some(
      (character) =>
        character.length === 1 &&
        character.charCodeAt(0) >= 0xd800 &&
        character.charCodeAt(0) <= 0xdfff,
    ) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input)
  )
    return fail(code);
  return input;
}
/** Reference facts only. No account control, location authenticity or listing access is inferred. */
export function validateListingReferenceCatalogue(input: unknown): ListingReferenceCatalogue {
  const code = 'INVALID_REFERENCE_CATALOGUE' as const,
    c = own(input, ['policy', 'version', 'country', 'locations', 'amenities'], code);
  if (c.policy !== 'synthetic-reference-catalogue-v1' || c.country !== 'KE') return fail(code);
  const currentVersion = version(c.version, code),
    seen = new Set<string>();
  const locations = array(c.locations, 5000, code).map((input) => {
    const row = own(input, ['id', 'kind', 'parentId', 'label'], code),
      id = uuid(row.id, code);
    if (seen.has(id) || !['county', 'locality', 'neighbourhood'].includes(row.kind as string))
      return fail(code);
    seen.add(id);
    const parentId = row.parentId === null ? null : uuid(row.parentId, code);
    if ((row.kind === 'county') !== (parentId === null)) return fail(code);
    return Object.freeze({
      id,
      kind: row.kind as ReferenceLocation['kind'],
      parentId,
      label: label(row.label, code),
    });
  });
  const byId = new Map(locations.map((row) => [row.id, row]));
  for (const row of locations)
    if (row.parentId !== null) {
      const parent = byId.get(row.parentId);
      if (!parent || parent.kind !== (row.kind === 'locality' ? 'county' : 'locality'))
        return fail(code);
    }
  const codes = new Set<string>();
  const amenities = array(c.amenities, 100, code).map((input) => {
    const row = own(input, ['id', 'code', 'label', 'propertyTypes'], code),
      id = uuid(row.id, code);
    if (
      seen.has(id) ||
      typeof row.code !== 'string' ||
      row.code.length > 64 ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(row.code) ||
      codes.has(row.code)
    )
      return fail(code);
    seen.add(id);
    codes.add(row.code);
    const types = array(row.propertyTypes, PROPERTY_TYPES.length, code);
    if (
      types.length === 0 ||
      new Set(types).size !== types.length ||
      types.some((type) => !PROPERTY_TYPES.includes(type as PropertyType))
    )
      return fail(code);
    return Object.freeze({
      id,
      code: row.code,
      label: label(row.label, code),
      propertyTypes: Object.freeze(PROPERTY_TYPES.filter((type) => types.includes(type))),
    });
  });
  return Object.freeze({
    policy: 'synthetic-reference-catalogue-v1',
    version: currentVersion,
    country: 'KE',
    locations: Object.freeze(locations),
    amenities: Object.freeze(amenities),
  });
}
/** Use a server-controlled catalogue. Caller-supplied reference facts cannot grant authority. */
export function selectListingReferenceAttributes(
  input: unknown,
  catalogueInput: unknown,
  propertyType: PropertyType | null,
): ListingReferenceSelection {
  const catalogue = validateListingReferenceCatalogue(catalogueInput),
    code = 'INVALID_REFERENCE_SELECTION' as const;
  const selected = own(input, ['catalogueVersion', 'location', 'amenityIds'], code),
    selectedVersion = version(selected.catalogueVersion, code);
  if (selectedVersion !== catalogue.version) return fail('STALE_REFERENCE_CATALOGUE');
  if (propertyType !== null && !PROPERTY_TYPES.includes(propertyType)) return fail(code);
  const location = own(selected.location, ['countyId', 'localityId', 'neighbourhoodId'], code),
    byId = new Map(catalogue.locations.map((row) => [row.id, row]));
  const countyId = location.countyId === null ? null : uuid(location.countyId, code),
    localityId = location.localityId === null ? null : uuid(location.localityId, code),
    neighbourhoodId =
      location.neighbourhoodId === null ? null : uuid(location.neighbourhoodId, code);
  if (
    countyId === null
      ? localityId !== null || neighbourhoodId !== null
      : byId.get(countyId)?.kind !== 'county'
  )
    return fail(code);
  if (
    localityId === null
      ? neighbourhoodId !== null
      : byId.get(localityId)?.kind !== 'locality' || byId.get(localityId)?.parentId !== countyId
  )
    return fail(code);
  if (
    neighbourhoodId !== null &&
    (byId.get(neighbourhoodId)?.kind !== 'neighbourhood' ||
      byId.get(neighbourhoodId)?.parentId !== localityId)
  )
    return fail(code);
  const ids = array(selected.amenityIds, 50, code).map((value) => uuid(value, code)),
    amenities = new Map(catalogue.amenities.map((row) => [row.id, row]));
  if (
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) => propertyType === null || !amenities.get(id)?.propertyTypes.includes(propertyType),
    )
  )
    return fail(code);
  return Object.freeze({
    catalogueVersion: selectedVersion,
    location: Object.freeze({ countyId, localityId, neighbourhoodId }),
    amenityIds: Object.freeze(ids.sort()),
  });
}
/** Detached labels for a future saved revision snapshot; not an approval/publication operation. */
export function snapshotListingReferenceAttributes(
  input: unknown,
  catalogueInput: unknown,
  propertyType: PropertyType | null,
) {
  const catalogue = validateListingReferenceCatalogue(catalogueInput),
    selected = selectListingReferenceAttributes(input, catalogue, propertyType);
  const locations = new Map(catalogue.locations.map((row) => [row.id, row])),
    amenities = new Map(catalogue.amenities.map((row) => [row.id, row]));
  const location = (id: string | null) =>
    id === null ? null : Object.freeze({ id, label: locations.get(id)!.label });
  return Object.freeze({
    catalogueVersion: selected.catalogueVersion,
    country: 'KE' as const,
    location: Object.freeze({
      county: location(selected.location.countyId),
      locality: location(selected.location.localityId),
      neighbourhood: location(selected.location.neighbourhoodId),
    }),
    amenities: Object.freeze(
      selected.amenityIds.map((id) => {
        const row = amenities.get(id)!;
        return Object.freeze({ id, code: row.code, label: row.label });
      }),
    ),
  });
}
