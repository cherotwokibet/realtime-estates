'use client';
import { validateAdminAuditPage, type AdminAuditQuery } from '@realtor/domain';
import PrivateWorkspaceBoundary from './PrivateWorkspaceBoundary.tsx';
import AdminAuditView from './AdminAuditView.tsx';
import { adminAuditHref } from '../lib/admin-audit-navigation.ts';
import { usePrivateSummary } from '../lib/use-private-summary.ts';
import type { RecoveryScope } from '../lib/private-recovery-contract.ts';
type Props = { scope: RecoveryScope; query: AdminAuditQuery };
export default function AdminAuditWorkspace(props: Props) {
  return (
    <PrivateWorkspaceBoundary
      key={[
        props.scope.instanceId,
        props.scope.tenantId,
        props.scope.actorId,
        props.query.limit,
        props.query.before,
        props.query.actorId,
        props.query.objectId,
      ].join(':')}
      access={{ profile: 'staff', ...props.scope, role: 'admin' }}
    >
      <AuditContent {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function AuditContent({ scope, query }: Props) {
  const read = usePrivateSummary(scope, 'audit', query);
  const page = read.data === null ? null : validateAdminAuditPage(read.data, scope.tenantId, query);
  return (
    <section aria-label="Private company activity">
      <button type="button" disabled={read.busy} onClick={() => void read.refresh()}>
        {page ? 'Refresh company activity' : 'Load company activity'}
      </button>
      <p role="status">
        {read.error ||
          (read.busy
            ? 'Loading current company activity.'
            : page
              ? 'Current activity loaded.'
              : 'Load current activity after access has been checked.')}
      </p>
      {page && (
        <AdminAuditView
          page={page}
          query={query}
          recentHref={adminAuditHref(query, null)}
          nextHref={page.nextBefore === null ? null : adminAuditHref(query, page.nextBefore)}
        />
      )}
    </section>
  );
}
