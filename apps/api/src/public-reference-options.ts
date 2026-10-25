/** Unfiltered approved public identities only. No active/private catalogue or private addresses. */
export const PUBLIC_REFERENCE_OPTIONS_SQL = `WITH source AS MATERIALIZED (
  SELECT reference_attributes AS attrs FROM app_api.public_listings_reference_v3
  WHERE reference_attributes IS NOT NULL
), choices AS (
  SELECT 'countyId' AS kind,attrs#>>'{location,county,id}' AS id,attrs#>>'{location,county,label}' AS label FROM source
  UNION ALL SELECT 'localityId',attrs#>>'{location,locality,id}',concat_ws(' › ',attrs#>>'{location,county,label}',attrs#>>'{location,locality,label}') FROM source
  UNION ALL SELECT 'neighbourhoodId',attrs#>>'{location,neighbourhood,id}',concat_ws(' › ',attrs#>>'{location,county,label}',attrs#>>'{location,locality,label}',attrs#>>'{location,neighbourhood,label}') FROM source
  UNION ALL SELECT 'amenityId',a->>'id',a->>'label' FROM source CROSS JOIN LATERAL jsonb_array_elements(COALESCE(attrs->'amenities','[]'::jsonb)) a
), grouped AS (
  SELECT kind,id,MIN(label COLLATE "C") AS label FROM choices WHERE id IS NOT NULL GROUP BY kind,id
)
SELECT kind,id,label FROM grouped ORDER BY kind,label COLLATE "C",id LIMIT 20001`;
export const PUBLIC_REFERENCE_OPTION_KEYS = [
  'countyId',
  'localityId',
  'neighbourhoodId',
  'amenityId',
] as const;
/** A limit overflow is a failure, never silently incomplete choices. */
export function publicReferenceOptions(rows: readonly Record<string, unknown>[]) {
  if (rows.length > 20000) throw Error('Public reference choices exceed bound.');
  const options: Record<
    (typeof PUBLIC_REFERENCE_OPTION_KEYS)[number],
    { id: string; label: string }[]
  > = { countyId: [], localityId: [], neighbourhoodId: [], amenityId: [] };
  const seen = new Set<string>();
  for (const input of rows) {
    if (
      !input ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).length !== 3
    )
      throw Error('Invalid public reference choice row.');
    const row: Record<string, unknown> = {};
    for (const key of ['kind', 'id', 'label']) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
        throw Error('Invalid public reference choice row.');
      row[key] = descriptor.value;
    }
    if (
      Object.keys(row).length !== 3 ||
      !Object.hasOwn(row, 'kind') ||
      !Object.hasOwn(row, 'id') ||
      !Object.hasOwn(row, 'label') ||
      !PUBLIC_REFERENCE_OPTION_KEYS.includes(
        row.kind as (typeof PUBLIC_REFERENCE_OPTION_KEYS)[number],
      ) ||
      typeof row.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id) ||
      seen.has(row.id) ||
      typeof row.label !== 'string' ||
      row.label !== row.label.trim() ||
      row.label.normalize('NFC') !== row.label ||
      [...row.label].length < 1 ||
      [...row.label].length > 512 ||
      /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(row.label)
    )
      throw Error('Invalid public reference choices.');
    seen.add(row.id);
    const group = options[row.kind as (typeof PUBLIC_REFERENCE_OPTION_KEYS)[number]];
    if (group.length >= 5000) throw Error('Public reference choices exceed category bound.');
    group.push({ id: row.id, label: row.label });
  }
  return { policy: 'synthetic-reference-options-v1', options, maximumPerCategory: 5000 };
}
