import { PROPERTY_TYPES, kesFromMajor } from '@realtor/domain';
export class PublicSearchInputError extends Error {
  constructor() {
    super('Use supported public search filters and pagination values.');
  }
}
const fail = (): never => {
  throw new PublicSearchInputError();
};
const keys = [
  'location',
  'purpose',
  'type',
  'period',
  'max',
  'beds',
  'privateBaths',
  'sharedBaths',
  'sort',
  'limit',
  'offset',
  'id',
];
/** Caller text is always a bind value. Identifiers and ordering are fixed application constants. */
export function publicSearchQuery(params: URLSearchParams, reference = false) {
  if (new TextEncoder().encode(params.toString()).byteLength > 8192) fail();
  const q: Record<string, string> = {};
  for (const [key, value] of params) {
    if (
      !(
        keys.includes(key) ||
        (reference && ['countyId', 'localityId', 'neighbourhoodId', 'amenityId'].includes(key))
      ) ||
      Object.hasOwn(q, key)
    )
      fail();
    q[key] = value;
  }
  const integer = (key: string, fallback: number, max: number, min = 0) => {
    if (!Object.hasOwn(q, key)) return fallback;
    if (!/^(0|[1-9]\d{0,6})$/.test(q[key]!) || Number(q[key]) < min || Number(q[key]) > max) fail();
    return Number(q[key]);
  };
  const limit = integer('limit', 24, 100, 1),
    offset = integer('offset', 0, 10000);
  const sort = q.sort || 'catalogue';
  if (!['catalogue', 'title', 'price_low', 'price_high'].includes(sort)) fail();
  if (q.purpose && !['sale', 'rent'].includes(q.purpose)) fail();
  if (q.type && !PROPERTY_TYPES.includes(q.type as (typeof PROPERTY_TYPES)[number])) fail();
  if (q.period && !['day', 'week', 'month', 'year'].includes(q.period)) fail();
  if (
    (q.max || sort.startsWith('price_')) &&
    !(q.purpose === 'sale' || (q.purpose === 'rent' && q.period))
  )
    fail();
  const values: unknown[] = [],
    predicates: string[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return '$' + values.length;
  };
  for (const key of [
    'id',
    ...(reference ? ['countyId', 'localityId', 'neighbourhoodId', 'amenityId'] : []),
  ]) {
    if (!q[key]) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(q[key]!))
      fail();
    const value = bind(q[key]);
    if (key === 'id') predicates.push('listing_id = ' + value + '::uuid');
    else if (key === 'amenityId')
      predicates.push(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(reference_attributes->'amenities','[]'::jsonb)) a WHERE a->>'id' = ${value})`,
      );
    else
      predicates.push(
        `reference_attributes#>>'{location,${key === 'countyId' ? 'county' : key === 'localityId' ? 'locality' : 'neighbourhood'},id}' = ${value}`,
      );
  }
  if (q.location) {
    const value = q.location.trim();
    if (!value || [...value].length > 160 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail();
    const pattern = '%' + value.replace(/[!%_]/g, '!$&') + '%';
    predicates.push(
      `(COALESCE(locality,'') || ' ' || COALESCE(location->>'county','') || ' ' || COALESCE(location->>'town','') || ' ' || COALESCE(location->>'area','')) ILIKE ${bind(pattern)} ESCAPE '!'`,
    );
  }
  if (q.purpose) predicates.push('purpose = ' + bind(q.purpose));
  if (q.type) predicates.push('property_type = ' + bind(q.type));
  if (q.period) predicates.push(`(purpose = 'sale' OR rent_period = ${bind(q.period)})`);
  for (const [key, column] of [
    ['beds', 'bedrooms'],
    ['privateBaths', 'private_bathrooms'],
    ['sharedBaths', 'shared_bathrooms'],
  ] as const) {
    if (q[key] !== undefined && q[key] !== '')
      predicates.push(column + (key === 'beds' ? ' = ' : ' >= ') + bind(integer(key, 0, 100)));
  }
  if (q.max) {
    let minor: number;
    try {
      minor = kesFromMajor(q.max).minorUnits;
    } catch {
      return fail();
    }
    if (minor <= 0) fail();
    predicates.push('amount_minor <= ' + bind(String(minor)) + '::bigint');
  }
  const order =
    sort === 'catalogue'
      ? '"approvedAt" DESC,id ASC'
      : sort === 'title'
        ? 'lower(title) COLLATE "C" ASC,id ASC'
        : '"amountMinor"::bigint ' + (sort === 'price_low' ? 'ASC' : 'DESC') + ',id ASC';
  const sql = `WITH filtered AS MATERIALIZED (
    SELECT listing_id AS id,slug,revision_no AS revision,title,description,purpose,
      property_type AS "propertyType",currency,amount_minor::text AS "amountMinor",rent_period AS "rentPeriod",bedrooms,
      private_bathrooms AS "privateBathrooms",shared_bathrooms AS "sharedBathrooms",country,locality,public_precision AS "publicPrecision",
      latitude::text AS latitude,longitude::text AS longitude,photo_refs AS photos,pricing,location,approved_at AS "approvedAt"
      ${reference ? ',reference_attributes AS "referenceAttributes",reference_revision_version AS "referenceRevisionVersion",reference_catalogue AS "referenceCatalogue"' : ''}
    FROM app_api.${reference ? 'public_listings_reference_v3' : 'public_listings_v2'} ${predicates.length ? 'WHERE ' + predicates.join(' AND ') : ''}
  ), paged AS (SELECT * FROM filtered ORDER BY ${order} LIMIT ${bind(limit)} OFFSET ${bind(offset)})
  SELECT (SELECT count(*)::text FROM filtered) AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'approvedAt' ORDER BY ${order}) FROM paged p),'[]'::jsonb) AS items`;
  return Object.freeze({ sql, values: Object.freeze(values), limit, offset, sort });
}
