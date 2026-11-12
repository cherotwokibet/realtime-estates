import { pushQueueConfiguration } from '../lib/push-queue-preview-server';
import type { CSSProperties } from 'react';
import { getDemoBrand, propertiesForCompany, resolveDemoTenantSlug } from '@realtor/demo';
import { formatKes, kesFromMinor } from '@realtor/domain';
import {
  deletionPrivacyConfiguration,
  deletionTriageConfiguration,
} from '../lib/deletion-triage-server';
import { previewConfiguration } from '../lib/staff-preview-policy';
import { getEnquiryPreviewScope } from '../lib/enquiry-preview-server';

const slug = resolveDemoTenantSlug(process.env.TENANT_SLUG);
const brand = getDemoBrand(slug);
const brandStyle = { '--brand': brand.primary } as CSSProperties;

type IconName =
  'overview' | 'enquiries' | 'reviews' | 'catalogue' | 'actions' | 'arrow' | 'check' | 'info';
const iconPaths: Record<IconName, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  enquiries: 'M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5',
  reviews: 'M9 3h6v4H9zM7 5H5v16h14V5h-2M8 14l3 3 5-6',
  catalogue: 'M3 11l9-8 9 8M5 10v11h14V10M9 21v-8h6v8',
  actions: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  check: 'M5 12l4 4L19 6',
  info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
};
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function Admin() {
  let deletionTriageEnabled = false;
  try {
    deletionTriageConfiguration(process.env);
    deletionTriageEnabled = true;
  } catch {}
  let pushQueueEnabled = false;
  try {
    pushQueueConfiguration(process.env);
    pushQueueEnabled = true;
  } catch {}
  let deletionPrivacyEnabled = false;
  try {
    deletionPrivacyConfiguration(process.env);
    deletionPrivacyEnabled = true;
  } catch {}
  let operationsEnabled = false;
  try {
    if (process.env.STAFF_ENQUIRY_PREVIEW_MODE === 'synthetic-v1') getEnquiryPreviewScope('admin');
    else previewConfiguration(process.env);
    operationsEnabled = true;
  } catch {}
  const properties = propertiesForCompany(slug);
  // Deliberately generated scenarios, scoped to this preview company; no customer activity is read.
  const enquiries = properties.slice(0, 3).map((property, index) => ({
    reference: `DEMO-E0${index + 1}`,
    property,
    topic:
      ['Availability enquiry', 'Monthly costs enquiry', 'Viewing request'][index] ??
      'Property enquiry',
    state: ['new', 'contacted', 'qualified'][index] ?? 'new',
    assignment: index === 0 ? 'Unassigned example' : null,
    viewingStage: index === 2 ? 'Viewing requested · not confirmed' : null,
    next:
      ['Assign a staff member', 'Clarify the known charges', 'Propose a viewing slot'][index] ??
      'Review enquiry',
  }));
  const reviews = properties.slice(0, 2).map((property, index) => ({
    property,
    reference: `DEMO-R0${index + 1}`,
    change: index === 0 ? 'Initial listing submission' : 'Price and description revision',
  }));
  const actions = properties.slice(0, 2).map((property, index) => ({
    property,
    title: index === 0 ? 'Confirm current availability' : 'Follow up on a proposed viewing',
    detail:
      index === 0
        ? 'Record an availability check before publishing.'
        : 'A request becomes confirmed only after customer agreement.',
  }));
  const metrics: { title: string; count: number; note: string; href: string; icon: IconName }[] = [
    {
      title: 'Catalogue examples',
      count: properties.length,
      note: 'From the shared demo catalogue',
      href: '#catalogue',
      icon: 'catalogue',
    },
    {
      title: 'Example enquiries',
      count: enquiries.length,
      note: 'Fictional inbox scenarios',
      href: '#enquiries',
      icon: 'enquiries',
    },
    {
      title: 'Example reviews',
      count: reviews.length,
      note: 'Fictional review scenarios',
      href: '#reviews',
      icon: 'reviews',
    },
    {
      title: 'Example next actions',
      count: actions.length,
      note: 'Fictional follow-up scenarios',
      href: '#actions',
      icon: 'actions',
    },
  ];
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="workspace" style={brandStyle}>
        <aside className="sidebar" aria-label="Company workspace">
          <a className="workspace-brand" href="#overview">
            <span className="brand-monogram" aria-hidden="true">
              {brand.initials}
            </span>
            <span>
              <strong>{brand.name}</strong>
              <small>STAFF WORKSPACE</small>
            </span>
          </a>
          <p className="nav-label">YOUR WORKSPACE</p>
          <nav className="workspace-nav" aria-label="Jump to workspace section">
            {operationsEnabled && (
              <a href="/operations">
                <Icon name="actions" />
                Daily work
              </a>
            )}
            <a href="#overview">
              <Icon name="overview" />
              Overview
            </a>
            <a href="#enquiries">
              <Icon name="enquiries" />
              Enquiry inbox<span className="nav-count">{enquiries.length}</span>
            </a>
            {process.env.NODE_ENV === 'development' &&
              process.env.STAFF_ENQUIRY_PREVIEW_MODE === 'synthetic-v1' && (
                <a href="/enquiries/admin">
                  <Icon name="enquiries" />
                  Connected synthetic inbox ↗
                </a>
              )}
            <a href="#reviews">
              <Icon name="reviews" />
              Review queue<span className="nav-count">{reviews.length}</span>
            </a>
            <a href="#catalogue">
              <Icon name="catalogue" />
              Property catalogue
            </a>
            {process.env.NODE_ENV === 'development' &&
              process.env.STAFF_PREVIEW_MODE === 'synthetic' && (
                <a href="/listings">
                  <Icon name="catalogue" />
                  Authorized listing work ↗
                </a>
              )}
            {process.env.NODE_ENV === 'development' &&
              process.env.STAFF_PREVIEW_MODE === 'synthetic' && (
                <a href="/settings">
                  <Icon name="actions" />
                  Company content and branding
                </a>
              )}
            {process.env.NODE_ENV === 'development' &&
              process.env.STAFF_AUDIT_PREVIEW_MODE === 'synthetic-admin-audit-v1' && (
                <a href="/audit">
                  <Icon name="actions" />
                  Activity history
                </a>
              )}
            <a href="#actions">
              <Icon name="actions" />
              Next actions
            </a>
          </nav>
          <div className="sidebar-note">
            <span className="demo-dot" aria-hidden="true" />
            <strong>Demo workspace</strong>
            <p>
              Explore the layout with synthetic examples. No staff session or live activity is
              represented.
            </p>
          </div>
          <div className="sidebar-footer">
            <span className="workspace-avatar" aria-hidden="true">
              P
            </span>
            <span>
              <strong>Preview mode</strong>
              <small>Read-only access</small>
            </span>
          </div>
        </aside>
        <main id="main">
          <div className="topbar">
            <p>
              Staff workspace <span aria-hidden="true">/</span> <strong>Overview</strong>
            </p>
            {deletionTriageEnabled && <a href="/deletion-triage">Account deletion requests</a>}
            {pushQueueEnabled && <a href="/push-queue">Notification queue</a>}
            {deletionPrivacyEnabled && <a href="/deletion-privacy">Deletion privacy review</a>}
            <span className="preview-pill">
              <span aria-hidden="true" />
              Read-only preview
            </span>
          </div>
          <div className="development-notice">
            <Icon name="info" />
            <p>
              <strong>Development preview.</strong> All catalogue entries and operational queues are
              synthetic. Authentication, updates and notifications are not connected on this
              overview.
            </p>
          </div>
          <header id="overview" className="page-header">
            <div>
              <p className="eyebrow">{brand.name}</p>
              <h1>Operations overview</h1>
              <p>Keep property information clear and the next follow-up in view.</p>
            </div>
            <a className="outline-link" href="#catalogue">
              View catalogue
              <Icon name="arrow" />
            </a>
          </header>
          <section className="stats" aria-label="Synthetic workspace summary">
            {metrics.map((metric) => (
              <a className="metric-card" href={metric.href} key={metric.title}>
                <div className="metric-top">
                  <span>{metric.title}</span>
                  <Icon name={metric.icon} />
                </div>
                <strong>{metric.count}</strong>
                <div className="metric-bottom">
                  <small>{metric.note}</small>
                  <Icon name="arrow" />
                </div>
              </a>
            ))}
          </section>
          <section id="enquiries" className="panel enquiry-panel" aria-labelledby="enquiries-title">
            <div className="panel-heading">
              <div>
                <div className="heading-label">
                  <h2 id="enquiries-title">Enquiry inbox</h2>
                  <span className="demo-label">Demo queue</span>
                </div>
                <p>A clear handover from first interest to the next action.</p>
              </div>
              <span className="record-count">{enquiries.length} examples</span>
            </div>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Scrollable fictional enquiry examples"
            >
              <table className="enquiry-table">
                <caption className="sr-only">
                  Fictional enquiry scenarios. No customer messages, identities or live statuses.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Enquiry / property</th>
                    <th scope="col">Status example</th>
                    <th scope="col">Next action example</th>
                    <th scope="col">Scenario details</th>
                  </tr>
                </thead>
                <tbody>
                  {enquiries.map((enquiry, index) => (
                    <tr key={enquiry.reference}>
                      <th scope="row">
                        <span className="table-reference">{enquiry.reference}</span>
                        <span className="row-title">{enquiry.topic}</span>
                        <span className="row-subtitle">
                          {enquiry.property.neighbourhood} · {label(enquiry.property.type)}
                        </span>
                      </th>
                      <td>
                        <span
                          className={`status-pill ${index === 0 ? 'status-new' : 'status-neutral'}`}
                        >
                          <span aria-hidden="true" />
                          {label(enquiry.state)}
                        </span>
                        {enquiry.assignment && (
                          <span className="row-subtitle">{enquiry.assignment}</span>
                        )}
                        {enquiry.viewingStage && (
                          <span className="row-subtitle">{enquiry.viewingStage}</span>
                        )}
                      </td>
                      <td>
                        <span className="next-action">{enquiry.next}</span>
                        <span className="row-subtitle">Illustrative · no deadline scheduled</span>
                      </td>
                      <td>
                        <details className="row-details">
                          <summary>
                            View scenario<span className="sr-only"> {enquiry.reference}</span>
                          </summary>
                          <p>
                            {enquiry.property.title}. This example illustrates a staff workflow; no
                            enquiry was received or assigned.
                          </p>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel-footnote">
              <Icon name="info" />
              <p>
                Real enquiries will appear after the secure workflow is connected. Opening a
                scenario does not send a message or change a record.
              </p>
            </div>
          </section>
          <div className="work-grid">
            <section id="reviews" className="panel" aria-labelledby="reviews-title">
              <div className="panel-heading">
                <div>
                  <div className="heading-label">
                    <h2 id="reviews-title">Awaiting review</h2>
                    <span className="demo-label">Demo queue</span>
                  </div>
                  <p>Inspect the proposed content before a publication decision.</p>
                </div>
              </div>
              <div className="review-list">
                {reviews.map((review) => (
                  <article className="review-item" key={review.reference}>
                    <div className="list-icon" aria-hidden="true">
                      <Icon name="reviews" />
                    </div>
                    <div>
                      <span className="table-reference">{review.reference}</span>
                      <h3>{review.property.title}</h3>
                      <p>{review.change}</p>
                      <span className="row-subtitle">
                        {review.property.neighbourhood} · Fictional pending revision
                      </span>
                      <details className="review-details">
                        <summary>
                          Review checklist<span className="sr-only"> for {review.reference}</span>
                        </summary>
                        <ul>
                          <li>Confirm the advertised price and rental period.</li>
                          <li>Check photo readiness and authority to advertise.</li>
                          <li>Compare the revision with the current publication.</li>
                        </ul>
                        <p>Approval controls are unavailable in this read-only preview.</p>
                      </details>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section id="actions" className="panel" aria-labelledby="actions-title">
              <div className="panel-heading">
                <div>
                  <div className="heading-label">
                    <h2 id="actions-title">Next actions</h2>
                    <span className="demo-label">Demo queue</span>
                  </div>
                  <p>Make ownership and follow-up visible.</p>
                </div>
              </div>
              <ol className="action-list">
                {actions.map((action, index) => (
                  <li key={action.property.id}>
                    <span className="action-number" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3>{action.title}</h3>
                      <p>
                        {action.property.neighbourhood} · {action.property.title}
                      </p>
                      <span className="row-subtitle">{action.detail}</span>
                      <span className="action-context">
                        Example only · not assigned or scheduled
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="action-note">
                <Icon name="check" />
                <p>
                  No completion controls are enabled. These examples show how a useful follow-up
                  queue can work.
                </p>
              </div>
            </section>
          </div>
          <section
            id="catalogue"
            className="panel catalogue-panel"
            aria-labelledby="catalogue-title"
          >
            <div className="panel-heading">
              <div>
                <div className="heading-label">
                  <h2 id="catalogue-title">Property catalogue</h2>
                  <span className="demo-label">Synthetic inventory</span>
                </div>
                <p>
                  Exact advertised prices, consistent property fields and a clear publication
                  boundary.
                </p>
              </div>
              <span className="record-count">{properties.length} examples</span>
            </div>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Scrollable synthetic property catalogue"
            >
              <table>
                <caption className="sr-only">
                  Synthetic catalogue for {brand.name}. All entries are preview-only and represent
                  no live availability.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Property</th>
                    <th scope="col">Location</th>
                    <th scope="col">Purpose / type</th>
                    <th scope="col">Base price</th>
                    <th scope="col">Publication</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map((property) => (
                    <tr key={property.id}>
                      <th scope="row">
                        <details className="property-details">
                          <summary>{property.title}</summary>
                          <p>{property.description}</p>
                          <p>
                            {property.bedrooms === null
                              ? 'Bedrooms not applicable'
                              : property.bedrooms === 0
                                ? label(property.type)
                                : `${property.bedrooms} bedrooms`}{' '}
                            ·{' '}
                            {property.bathrooms === null
                              ? 'Bathrooms not specified'
                              : `${property.bathrooms} bathroom${property.bathrooms === 1 ? '' : 's'}`}{' '}
                            · {property.areaSqm} m²
                          </p>
                        </details>
                        <span className="table-reference">{property.id}</span>
                      </th>
                      <td>
                        <span className="cell-main">{property.neighbourhood}</span>
                        <span className="row-subtitle">{property.county}</span>
                      </td>
                      <td>
                        <span className="cell-main">
                          {property.purpose === 'rent' ? 'For rent' : 'For sale'}
                        </span>
                        <span className="row-subtitle">{label(property.type)}</span>
                      </td>
                      <td className="price-cell">
                        <strong>{formatKes(kesFromMinor(property.priceMinor))}</strong>
                        <span className="row-subtitle">
                          {property.rentalPeriod ? `per ${property.rentalPeriod}` : 'Sale price'}
                        </span>
                      </td>
                      <td>
                        <span className="status-pill status-neutral">Preview only</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel-footnote">
              <Icon name="info" />
              <p>
                Additional charges have not been supplied for these examples. Base prices are not
                all-in totals. No listing is published from this workspace.
              </p>
            </div>
          </section>
          <footer className="workspace-footer">
            <p>{brand.name} · Independently rebuilt workspace</p>
            <span>Design preview · Synthetic data</span>
          </footer>
        </main>
      </div>
    </>
  );
}
