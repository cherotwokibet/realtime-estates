import { headers } from 'next/headers';
import AdminAuditView from '../../components/AdminAuditView.tsx';
import {
  adminAuditHostAllowed,
  adminAuditHref,
  loadAdminAuditWorkspace,
} from '../../lib/admin-audit-server.ts';
import './audit.css';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let data: Awaited<ReturnType<typeof loadAdminAuditWorkspace>> | null = null;
  try {
    const incoming = await headers();
    if (adminAuditHostAllowed(incoming.get('host'), process.env))
      data = await loadAdminAuditWorkspace(await searchParams);
  } catch {}
  return (
    <main className="audit-page">
      <a className="skip" href="#audit-title">
        Skip to activity
      </a>
      <header>
        <a href="/">Staff workspace</a>
        <span> / </span>
        <a href="/operations">Daily work</a>
      </header>
      <div className="audit-intro">
        <p className="audit-eyebrow">ADMINISTRATION / ACTIVITY</p>
        <h1 id="audit-title">A record of what changed.</h1>
        <p>Review the actor, record and original version behind an action.</p>
      </div>
      <p className="audit-notice">
        Synthetic local preview · Current company administrator access required. Private summaries,
        contact details and reasons are excluded.
      </p>
      {data ? (
        <AdminAuditView
          {...data}
          recentHref={adminAuditHref(data.query, null)}
          nextHref={
            data.page.nextBefore === null ? null : adminAuditHref(data.query, data.page.nextBefore)
          }
        />
      ) : (
        <section className="audit-empty" role="alert">
          <h2>Activity unavailable</h2>
          <p>
            A fresh authorized admin read and valid filters are required. Previous event details are
            not displayed.
          </p>
          <a href="/audit">Retry latest activity</a>
        </section>
      )}
      <footer>
        Each navigation checks current access. This is a live activity list, not a complete
        historical export.
      </footer>
    </main>
  );
}
