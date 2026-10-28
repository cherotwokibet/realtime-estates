import { validateStaffOperationsOverview } from '@realtor/domain';
import type { TransactionQuery } from './database.js';
/** Both caller and SQL function check current admin membership. */
export async function readStaffOperationsOverview(query: TransactionQuery) {
  await query.query("SET LOCAL statement_timeout = '2s'");
  const result = await query.query('SELECT app_api.read_operations_overview() AS overview');
  if (result.rows.length !== 1) throw Error('Invalid operations overview.');
  return validateStaffOperationsOverview(result.rows[0]!.overview);
}
