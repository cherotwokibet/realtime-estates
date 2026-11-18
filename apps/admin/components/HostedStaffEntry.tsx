import { hostedStaff } from '../lib/hosted-staff-runtime';
import HostedStaffWorkspace from './HostedStaffWorkspace';
export default function HostedStaffEntry() {
  try {
    const staff = hostedStaff();
    if (staff)
      return (
        <main>
          <HostedStaffWorkspace tenantId={staff.tenantId} />
        </main>
      );
  } catch {
    /* Hosted setup must never fall through to synthetic authority. */
  }
  return (
    <main className="hosted-staff">
      <h1>Staff administration is unavailable here.</h1>
      <p>Workspace setup must be completed before branch administration can open.</p>
      <a href="/sign-in">Manage sign-in</a>
    </main>
  );
}
