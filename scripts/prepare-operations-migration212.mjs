/** One-shot conversion of the new uncommitted query to a narrow definer read.
 * No existing migration is overwritten and no migration is executed here.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
const source = new URL('../apps/api/src/operations-overview.ts', import.meta.url);
const target = new URL('../database/migrations/0032_operations_overview.sql', import.meta.url);
try {
  await access(target);
  throw Error('Operations migration already exists.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const previous = await readFile(source, 'utf8');
const query = previous.split('`')[1];
assert.ok(query?.includes('WITH clock AS MATERIALIZED'));
const end = query.indexOf('SELECT to_char(clock.captured');
assert.ok(end > 0);
const ctes = query
  .slice(0, end)
  .replaceAll('$1::uuid', 'tenant')
  .replace("interval '30 days'", "interval '720 hours'");
const names = [
  ['staleStock', 'stale', '"lastCheckedAt" ASC NULLS FIRST,"listingId" ASC'],
  ['pendingReviews', 'reviews', '"submittedAt" ASC,"listingId" ASC,revision ASC'],
  ['overdueEnquiries', 'overdue', '"nextActionAt" ASC,"enquiryId" ASC'],
  ['viewingOutcomes', 'outcomes', '"endedAt" ASC,"viewingId" ASC'],
];
const fields = names
  .map(
    ([key, table, order]) =>
      `'${key}',(SELECT coalesce(jsonb_agg(to_jsonb(${table}) ORDER BY ${order}),'[]'::jsonb) FROM ${table})`,
  )
  .join(',\n');
const sql = `BEGIN;
SET LOCAL ROLE realtor_owner;
CREATE INDEX listing_availability_work ON app_private.listings(tenant_id,last_availability_confirmed_at,id) WHERE publication_status='published' AND availability='available';
CREATE INDEX revision_pending_work ON app_private.listing_revisions(tenant_id,submitted_at,listing_id,revision_no) WHERE state='pending';
CREATE INDEX enquiry_due_work ON app_private.enquiries(tenant_id,next_action_at,id) WHERE status IN ('new','assigned','contacted','qualified') AND next_action_at IS NOT NULL;
CREATE INDEX viewing_outcome_work ON app_private.viewings(tenant_id,id) WHERE status='confirmed';
-- No raw table permission is added. Current admin membership is checked inside SQL.
CREATE FUNCTION app_api.read_operations_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;tenant uuid:=app_private.context_tenant();queue_name text;items jsonb;
BEGIN
 PERFORM app_private.assert_staff(ARRAY['admin']);
 ${ctes}
 SELECT jsonb_build_object('policy','staff-operations-overview-v1','asOf',to_char(clock.captured AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'freshnessDays',30,'limit',10,
 ${fields}) INTO result FROM clock;
 FOREACH queue_name IN ARRAY ARRAY['staleStock','pendingReviews','overdueEnquiries','viewingOutcomes'] LOOP
  items:=result->queue_name;
  result:=jsonb_set(result,ARRAY[queue_name],jsonb_build_object('items',
   (SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(items) WITH ORDINALITY WHERE ordinality<=10),
   'hasMore',jsonb_array_length(items)>10));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_api.read_operations_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_api.read_operations_overview() TO api_runtime;
COMMIT;
`;
assert.equal((sql.match(/LIMIT 11/g) || []).length, 4);
await writeFile(target, sql);
await writeFile(
  source,
  `import { validateStaffOperationsOverview } from '@realtor/domain';
import type { TransactionQuery } from './database.js';
/** Both caller and SQL function check current admin membership. */
export async function readStaffOperationsOverview(query: TransactionQuery) {
  await query.query("SET LOCAL statement_timeout = '2s'");
  const result = await query.query('SELECT app_api.read_operations_overview() AS overview');
  if(result.rows.length!==1)throw Error('Invalid operations overview.');
  return validateStaffOperationsOverview(result.rows[0]!.overview);
}
`,
);
console.log('Prepared narrow operations SQL read and adapter. No database was modified.');
