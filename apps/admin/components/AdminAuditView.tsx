import type { AdminAuditPage, AdminAuditQuery } from '@realtor/domain';

export default function AdminAuditView({
  page,
  query,
  nextHref,
  recentHref,
}: {
  page: AdminAuditPage;
  query: AdminAuditQuery;
  nextHref: string | null;
  recentHref: string;
}) {
  return (
    <>
      <section className="audit-filters" aria-labelledby="audit-filter-title">
        <h2 id="audit-filter-title">Find an action</h2>
        <form action="/audit" method="get">
          <label>
            Actor reference
            <input
              name="actorId"
              defaultValue={query.actorId ?? ''}
              maxLength={36}
              autoComplete="off"
              placeholder="All actors"
            />
          </label>
          <label>
            Record reference
            <input
              name="objectId"
              defaultValue={query.objectId ?? ''}
              maxLength={36}
              autoComplete="off"
              placeholder="All records"
            />
          </label>
          <label>
            Events per page
            <select name="limit" defaultValue={String(query.limit)}>
              {[...new Set([5, 10, 20, query.limit])]
                .sort((a, b) => a - b)
                .map((limit) => (
                  <option key={limit} value={limit}>
                    {limit}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit">Apply filters</button>
          <a href="/audit">Clear filters</a>
        </form>
        <p>
          References are the complete UUIDs shown in each event. Filters never change your company
          or permissions.
        </p>
      </section>
      <section aria-labelledby="audit-events-title">
        <div className="audit-section-title">
          <h2 id="audit-events-title">Company activity</h2>
          <a href={recentHref}>Refresh latest events</a>
        </div>
        <p className="audit-company">
          Company reference: <code>{page.tenantId}</code>
        </p>
        {page.items.length === 0 ? (
          <div className="audit-empty" role="status">
            <h3>No matching events</h3>
            <p>Try clearing the actor or record filter. No actions are changed by this view.</p>
          </div>
        ) : (
          <ol className="audit-events">
            {page.items.map((event) => (
              <li key={event.id}>
                <div className="audit-event-heading">
                  <h3>{event.action.split(/[._]/).join(' ')}</h3>
                  <span>Event {event.id}</span>
                </div>
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString('en-KE', {
                    timeZone: 'Africa/Nairobi',
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  })}{' '}
                  EAT
                </time>
                <dl>
                  <div>
                    <dt>Actor reference</dt>
                    <dd>{event.actorId ?? 'System event'}</dd>
                  </div>
                  <div>
                    <dt>Record</dt>
                    <dd>
                      {event.objectType} · <code>{event.objectId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Recorded version</dt>
                    <dd>{event.objectVersion ?? 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Action code</dt>
                    <dd>
                      <code>{event.action}</code>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
        <nav className="audit-pagination" aria-label="Audit event pages">
          <a href={recentHref}>Most recent</a>
          {nextHref ? <a href={nextHref}>Older events →</a> : <span>End of this result</span>}
        </nav>
      </section>
    </>
  );
}
