import type { CSSProperties } from 'react';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import {
  getEnquiryPreviewScope,
  loadViewingCalendarPreview,
} from '../../../lib/enquiry-preview-server.ts';
import { viewingCalendarSelection } from '../../../lib/viewing-calendar-model.ts';
import type { EntryQuery } from '../../../lib/operations-navigation.ts';
import ViewingCalendar from '../../../components/ViewingCalendar.tsx';
import '../viewings.css';
export const dynamic = 'force-dynamic';
export default async function ViewingCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ actor: string }>;
  searchParams?: Promise<EntryQuery>;
}) {
  const { actor } = await params,
    brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  let selection: ReturnType<typeof viewingCalendarSelection> | null = null,
    data: Awaited<ReturnType<typeof loadViewingCalendarPreview>> | null = null,
    error = '';
  try {
    if (actor !== 'admin' && actor !== 'agent') throw Error('Calendar scope unavailable.');
    getEnquiryPreviewScope(actor);
    selection = viewingCalendarSelection((await searchParams) ?? {});
  } catch {
    error = 'Choose a supported calendar date and range in an authorized staff workspace.';
  }
  if (selection)
    try {
      data = await loadViewingCalendarPreview(actor, selection.window);
    } catch {
      error =
        'The current calendar could not be read. Retry to check access and the latest records.';
    }
  return (
    <main className="calendar-page" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#viewing-calendar-title">
        Skip to viewing calendar
      </a>
      <header className="calendar-masthead">
        <a href="/">{brand.name} · Staff workspace</a>
        <span>Independent platform preview</span>
      </header>
      <nav aria-label="Calendar workspaces">
        <a href={`/enquiries/${actor === 'agent' ? 'agent' : 'admin'}`}>Enquiry workspace</a>
        {actor === 'admin' && <a href="/operations">Daily work</a>}
      </nav>
      <p className="calendar-eyebrow">
        VIEWING COORDINATION / {actor === 'agent' ? 'AGENT' : 'ADMIN'}
      </p>
      <h1 id="viewing-calendar-title">Plan the next conversation.</h1>
      <p>
        View proposed and confirmed slots in Nairobi time, then open a fresh record to prepare a
        deliberate change. Check staff availability before confirming; this calendar does not
        reserve time or establish attendance.
      </p>
      <p className="calendar-notice">
        Synthetic data · No invitations or reminders are sent.{' '}
        {process.env.STAFF_REMINDER_CAPTURE_MODE === 'capture-only-v1'
          ? 'A test reminder capture can be inspected in the viewing workspace.'
          : 'Notification delivery is unavailable in this local preview.'}
      </p>
      {selection && (
        <form method="get" className="calendar-filter">
          <label>
            Starting date · Nairobi
            <input type="date" name="date" defaultValue={selection.date} required />
          </label>
          <label>
            Show
            <select name="days" defaultValue={String(selection.days)}>
              <option value="1">One day</option>
              <option value="7">Seven days</option>
              <option value="14">Fourteen days</option>
              <option value="31">Thirty-one days</option>
            </select>
          </label>
          <button type="submit">Read calendar</button>
        </form>
      )}
      {error && (
        <section role="alert" className="calendar-unavailable">
          <h2>Calendar unavailable</h2>
          <p>{error} Previous private rows are not displayed.</p>
          <a href={`/viewings/${actor === 'agent' ? 'agent' : 'admin'}`}>
            Retry with the current week
          </a>
        </section>
      )}
      {data && (actor === 'admin' || actor === 'agent') && (
        <ViewingCalendar data={data} actor={actor} />
      )}
    </main>
  );
}
