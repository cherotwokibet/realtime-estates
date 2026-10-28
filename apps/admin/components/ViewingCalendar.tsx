import type { StaffViewingCalendar } from '@realtor/api-client';
import { calendarDay, calendarTime as formatEnquiryTime } from '../lib/viewing-calendar-model.ts';
const labels = {
  proposed: 'Proposed · awaiting agreement',
  confirmed: 'Confirmed · phone agreement recorded',
  cancelled: 'Cancelled',
  declined: 'Declined',
  completed: 'Completed · staff-reported',
  no_show: 'No-show · staff-reported',
} as const;
export default function ViewingCalendar({
  data,
  actor,
}: {
  data: StaffViewingCalendar;
  actor: 'admin' | 'agent';
}) {
  const days = new Map<string, StaffViewingCalendar['scheduled']['items'][number][]>();
  for (const item of data.scheduled.items) {
    const date = calendarDay(item.slot.startAt);
    const group = days.get(date) ?? [];
    group.push(item);
    days.set(date, group);
  }
  const link = (enquiryId: string, viewingId: string) =>
    `/enquiries/${actor}?enquiryId=${encodeURIComponent(enquiryId)}&viewingId=${encodeURIComponent(viewingId)}&viewingMode=inspect`;
  return (
    <>
      <p className="calendar-clock">
        Read at {formatEnquiryTime(data.asOf)}.{' '}
        {actor === 'admin' ? 'Current company view.' : 'Assigned enquiries only.'} These are
        displayed records, not company totals.
      </p>
      <section aria-labelledby="calendar-scheduled-title">
        <h2 id="calendar-scheduled-title">Scheduled viewings</h2>
        <p>
          {data.scheduled.items.length} shown
          {data.scheduled.hasMore ? ' · more available; choose a shorter date range' : ''}. Slots
          overlapping the selected window, including cancelled and recorded outcomes.
        </p>
        {!data.scheduled.items.length ? (
          <p className="calendar-empty">No scheduled viewings in this window for current access.</p>
        ) : (
          <div className="calendar-days">
            {[...days].map(([day, items]) => (
              <section className="calendar-day" aria-label={day} key={day}>
                <h3>{day} · Nairobi</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item.viewingId}>
                      <strong>{item.title}</strong>
                      <span className="calendar-state">{labels[item.status]}</span>
                      <p>
                        {formatEnquiryTime(item.slot.startAt)} –{' '}
                        {formatEnquiryTime(item.slot.endAt)}
                      </p>
                      {item.enquiryClosed && (
                        <p className="calendar-warning">
                          The enquiry is closed. Check its current status before changing a viewing.
                        </p>
                      )}
                      <a href={link(item.enquiryId, item.viewingId)}>Open this viewing record</a>
                      <small>
                        Viewing {item.viewingId} · version {item.version} at this read. The next
                        screen reads it again.
                      </small>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="calendar-unscheduled-title">
        <h2 id="calendar-unscheduled-title">Requests without a proposed time</h2>
        <p>
          {data.unscheduled.items.length} shown
          {data.unscheduled.hasMore ? ' · more requests exist' : ''}. The oldest requests across all
          dates, separate from the scheduled window. Preferred times are not confirmed appointments.
        </p>
        {!data.unscheduled.items.length ? (
          <p className="calendar-empty">No requests awaiting a proposed time for current access.</p>
        ) : (
          <ul className="calendar-requests">
            {data.unscheduled.items.map((item) => (
              <li key={item.viewingId}>
                <strong>{item.title}</strong>
                <p>
                  Requested {formatEnquiryTime(item.createdAt)}
                  {item.enquiryClosed ? ' · enquiry closed' : ''}.
                </p>
                <a href={link(item.enquiryId, item.viewingId)}>Open request and propose a time</a>
              </li>
            ))}
          </ul>
        )}
        {data.unscheduled.hasMore && (
          <p>
            Only the oldest25 requests are shown. Complete work in the enquiry workspace and refresh
            for the next records.
          </p>
        )}
      </section>
    </>
  );
}
