import {
  validateStaffViewingCalendar,
  validateViewingCalendarWindow,
  type ViewingCalendarWindow,
} from '@realtor/domain';
import type { TransactionQuery } from './database.js';
export class ViewingCalendarInputError extends Error {
  constructor() {
    super('Invalid calendar read.');
  }
}
/** The date window selects time only; company, actor and role remain server-owned. */
export function viewingCalendarRequest(request: Request): ViewingCalendarWindow {
  const url = new URL(request.url);
  let invalid = request.body !== null || request.url.includes('#');
  request.headers.forEach((_, name) => {
    if (
      [
        'cookie',
        'content-type',
        'content-length',
        'content-encoding',
        'transfer-encoding',
        'expect',
        'range',
        'idempotency-key',
        'x-actor-id',
        'x-tenant-id',
        'x-role',
        'x-actor',
        'x-tenant',
        'x-company-id',
        'x-assigned-agent-id',
        'x-revision-version',
      ].includes(name) ||
      name.startsWith('if-')
    )
      invalid = true;
  });
  const entries = [...url.searchParams.entries()];
  if (
    invalid ||
    entries.length !== 2 ||
    entries.some(([key]) => !['fromAt', 'untilAt'].includes(key)) ||
    url.searchParams.getAll('fromAt').length !== 1 ||
    url.searchParams.getAll('untilAt').length !== 1 ||
    url.search
      .slice(1)
      .split('&')
      .some((part) => !part.startsWith('fromAt=') && !part.startsWith('untilAt='))
  )
    throw new ViewingCalendarInputError();
  try {
    return validateViewingCalendarWindow({
      fromAt: url.searchParams.get('fromAt'),
      untilAt: url.searchParams.get('untilAt'),
      timeZone: 'Africa/Nairobi',
    });
  } catch {
    throw new ViewingCalendarInputError();
  }
}
export async function readStaffViewingCalendar(
  query: TransactionQuery,
  window: ViewingCalendarWindow,
) {
  await query.query("SET LOCAL statement_timeout = '2s'");
  const result = await query.query(
    'SELECT app_api.read_viewing_calendar($1::timestamptz,$2::timestamptz) AS calendar',
    [window.fromAt, window.untilAt],
  );
  if (result.rows.length !== 1) throw Error('Invalid calendar projection.');
  return validateStaffViewingCalendar(result.rows[0]!.calendar, window);
}
