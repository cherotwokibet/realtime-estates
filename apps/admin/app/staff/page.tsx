import StaffDirectoryWorkspace from '../../components/StaffDirectoryWorkspace.tsx';
import { loadStaffDirectoryWorkspace } from '../../lib/staff-directory-server.ts';
import './staff.css';
export const dynamic = 'force-dynamic';
export default async function Staff() {
  let data: Awaited<ReturnType<typeof loadStaffDirectoryWorkspace>> | null = null;
  try {
    data = await loadStaffDirectoryWorkspace();
  } catch {}
  return (
    <main className="staff-page">
      <a href="#staff-title" className="skip">
        Skip to staff operations
      </a>
      <header>
        <a href="/">Staff workspace</a> · <a href="/operations">Daily work</a>
      </header>
      <h1 id="staff-title">Branches and invitation requests</h1>
      <p>
        Synthetic local preview · Current company admin access required. Requests do not send email
        or grant access.
      </p>
      {data ? (
        <StaffDirectoryWorkspace
          key={data.scope.instanceId + ':' + data.scope.tenantId + ':' + data.scope.actorId}
          {...data}
        />
      ) : (
        <section role="alert">
          <h2>Staff operations unavailable</h2>
          <p>A fresh authorized admin read is required. Previous private data is not displayed.</p>
          <a href="/staff">Retry staff operations</a>
        </section>
      )}
    </main>
  );
}
