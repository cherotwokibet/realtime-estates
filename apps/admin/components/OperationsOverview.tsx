import type { StaffOperationsOverview } from '@realtor/api-client';
import { formatEnquiryTime } from '../lib/enquiry-model.ts';
function Queue({
  title,
  description,
  items,
  hasMore,
}: {
  title: string;
  description: string;
  items: readonly React.ReactNode[];
  hasMore: boolean;
}) {
  return (
    <section className="ops-queue" aria-label={title}>
      <div className="ops-queue-heading">
        <h2>{title}</h2>
        <span>
          {items.length} shown{hasMore ? ' · more available' : ''}
        </span>
      </div>
      <p>{description}</p>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="ops-empty">No work in this queue at the snapshot time.</p>
      )}
      {hasMore && (
        <p className="ops-more">
          This summary shows the ten oldest items. Complete work or use its workspace, then refresh
          this overview.
        </p>
      )}
    </section>
  );
}
export default function OperationsOverview({ data }: { data: StaffOperationsOverview }) {
  return (
    <>
      <p className="ops-clock">
        Snapshot: {formatEnquiryTime(data.asOf)} · Up to ten items per queue. These are displayed
        items, not company totals.
      </p>
      <div className="ops-queues">
        <Queue
          title="Check availability"
          description="Published available stock with no confirmation or a confirmation more than 30 days (720 hours) old. Review it before relying on availability."
          hasMore={data.staleStock.hasMore}
          items={data.staleStock.items.map((item) => (
            <>
              <a href={`/listings/${item.listingId}/controls`}>Check {item.title}</a>
              <span>
                Last confirmed:{' '}
                {item.lastCheckedAt ? formatEnquiryTime(item.lastCheckedAt) : 'Not recorded'}
              </span>
            </>
          ))}
        />
        <Queue
          title="Review submissions"
          description="Submitted revisions awaiting an admin decision."
          hasMore={data.pendingReviews.hasMore}
          items={data.pendingReviews.items.map((item) => (
            <>
              <a href={`/reviews?listingId=${item.listingId}&revision=${item.revision}`}>
                Review {item.title} · revision {item.revision}
              </a>
              <span>Submitted: {formatEnquiryTime(item.submittedAt)}</span>
            </>
          ))}
        />
        <Queue
          title="Follow up overdue enquiries"
          description="Open enquiries with a saved next action before the snapshot time."
          hasMore={data.overdueEnquiries.hasMore}
          items={data.overdueEnquiries.items.map((item) => (
            <>
              <a href={`/enquiries/admin?enquiryId=${item.enquiryId}`}>
                Follow up with {item.name}
              </a>
              <span>Due: {formatEnquiryTime(item.nextActionAt)}</span>
            </>
          ))}
        />
        <Queue
          title="Record viewing outcomes"
          description="Confirmed slots have ended and still need a staff-recorded outcome. Attendance has not been established."
          hasMore={data.viewingOutcomes.hasMore}
          items={data.viewingOutcomes.items.map((item) => (
            <>
              <a href={`/enquiries/admin?enquiryId=${item.enquiryId}&viewingId=${item.viewingId}`}>
                Record outcome for {item.title}
              </a>
              <span>Slot ended: {formatEnquiryTime(item.endedAt)}</span>
            </>
          ))}
        />
      </div>
    </>
  );
}
