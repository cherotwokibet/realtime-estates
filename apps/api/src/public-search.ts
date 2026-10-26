import {
  PROPERTY_TYPES,
  kesFromMajor,
  parseSearchAreaPolygon,
  type SearchAreaPolygon,
} from '@realtor/domain';
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
  'min',
  'minMode',
  'max',
  'beds',
  'bedsMode',
  'privateBaths',
  'sharedBaths',
  'sort',
  'limit',
  'offset',
  'id',
  'area',
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
  if (q.minMode && q.minMode !== 'over') fail();
  if (q.bedsMode && q.bedsMode !== 'at_least') fail();
  if (q.bedsMode === 'at_least' && (q.beds === undefined || q.beds === '')) fail();
  if (
    (q.min || q.max || sort.startsWith('price_')) &&
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
  if (q.area !== undefined) {
    let area: SearchAreaPolygon;
    try {
      const parsed = parseSearchAreaPolygon(JSON.parse(q.area));
      if (parsed === null) return fail();
      area = parsed;
    } catch {
      return fail();
    }
    const ring = area.coordinates[0]!;
    const longitudes = ring.slice(0, -1).map(([longitude]) => longitude);
    const latitudes = ring.slice(0, -1).map(([, latitude]) => latitude);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    predicates.push(
      `longitude BETWEEN ${bind(String(minLongitude))}::numeric AND ${bind(String(maxLongitude))}::numeric`,
    );
    predicates.push(
      `latitude BETWEEN ${bind(String(minLatitude))}::numeric AND ${bind(String(maxLatitude))}::numeric`,
    );
    const rows = ring
      .slice(0, -1)
      .map((start, index) => {
        const end = ring[index + 1]!;
        return `(${bind(String(start[0]))}::numeric,${bind(String(start[1]))}::numeric,${bind(String(end[0]))}::numeric,${bind(String(end[1]))}::numeric)`;
      })
      .join(',');
    const edges = `(VALUES ${rows}) AS edge(x1,y1,x2,y2)`;
    const boundary = `EXISTS (SELECT 1 FROM ${edges} WHERE ABS((longitude-x1)*(y2-y1)-(latitude-y1)*(x2-x1))<=0.0000000001 AND longitude BETWEEN LEAST(x1,x2)-0.0000000001 AND GREATEST(x1,x2)+0.0000000001 AND latitude BETWEEN LEAST(y1,y2)-0.0000000001 AND GREATEST(y1,y2)+0.0000000001)`;
    const crossings = `(SELECT count(*) FROM ${edges} WHERE (y1>latitude)<>(y2>latitude) AND longitude < x1+(latitude-y1)*(x2-x1)/NULLIF(y2-y1,0))%2=1`;
    predicates.push(
      `latitude IS NOT NULL AND longitude IS NOT NULL AND (${boundary} OR ${crossings})`,
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
      predicates.push(
        column +
          (key === 'beds' && q.bedsMode !== 'at_least' ? ' = ' : ' >= ') +
          bind(integer(key, 0, 100)),
      );
  }
  const prices: Partial<Record<'min' | 'max', number>> = {};
  for (const key of ['min', 'max'] as const) {
    if (!q[key]) continue;
    try {
      prices[key] = kesFromMajor(q[key]).minorUnits;
    } catch {
      return fail();
    }
    if (prices[key]! <= 0) fail();
    predicates.push(
      'amount_minor ' +
        (key === 'min' ? (q.minMode === 'over' ? '> ' : '>= ') : '<= ') +
        bind(String(prices[key])) +
        '::bigint',
    );
  }
  if (q.minMode === 'over' && prices.min === undefined) fail();
  if (prices.min !== undefined && prices.max !== undefined && prices.min > prices.max) fail();
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
