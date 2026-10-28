import { validateViewingCalendarWindow, type ViewingCalendarWindow } from '@realtor/api-client';
import type { EntryQuery } from './operations-navigation.ts';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function parts(instant: number) {
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}
function dateAt(instant: number) {
  const p = parts(instant);
  return `${p.year!.padStart(4, '0')}-${p.month}-${p.day}`;
}
function midnight(date: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Choose a valid calendar date.');
  const wall = Date.parse(date + 'T00:00:00.000Z');
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== date)
    throw Error('Choose a valid calendar date.');
  let result = wall;
  for (let n = 0; n < 3; n++) {
    const p = parts(result),
      local = Date.parse(
        `${p.year!.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`,
      );
    const next = wall - (local - result);
    if (next === result) break;
    result = next;
  }
  const p = parts(result);
  if (dateAt(result) !== date || p.hour !== '00' || p.minute !== '00' || p.second !== '00')
    throw Error('This calendar date cannot be resolved.');
  return new Date(result).toISOString();
}
export function viewingCalendarSelection(
  query: EntryQuery,
  now = Date.now(),
): Readonly<{ date: string; days: number; window: ViewingCalendarWindow }> {
  if (!Number.isFinite(now) || Object.keys(query).some((key) => !['date', 'days'].includes(key)))
    throw Error('Use date and days only.');
  const date = query.date ?? dateAt(now),
    days = query.days ?? '7';
  if (
    typeof date !== 'string' ||
    typeof days !== 'string' ||
    !['1', '7', '14', '31'].includes(days)
  )
    throw Error('Choose a date and a supported calendar range.');
  const fromAt = midnight(date),
    last = new Date(Date.parse(date + 'T00:00:00.000Z') + Number(days) * 86400000)
      .toISOString()
      .slice(0, 10);
  const window = validateViewingCalendarWindow({
    fromAt,
    untilAt: midnight(last),
    timeZone: 'Africa/Nairobi',
  });
  return Object.freeze({ date, days: Number(days), window });
}
export function calendarDay(instant: string) {
  return dateAt(Date.parse(instant));
}
const timeFormatter = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});
export function calendarTime(instant: string) {
  return timeFormatter.format(new Date(instant));
}
