import { readStaffAllocationScope } from '../../lib/staff-allocation-scope.ts';
import CompanySettingsWorkspace from '../../components/CompanySettingsWorkspace.tsx';
import { loadCompanySettings } from '../../lib/company-settings-server.ts';
import './settings.css';
export const dynamic = 'force-dynamic';
export default async function Settings() {
  let scope: Awaited<ReturnType<typeof readStaffAllocationScope>> | null = null;
  let result: Awaited<ReturnType<typeof loadCompanySettings>> | null = null;
  try {
    scope = await readStaffAllocationScope();
    result = await loadCompanySettings();
  } catch {}
  return (
    <main className="settings-page">
      <a href="#settings-title" className="skip">
        Skip to company settings
      </a>
      <header>
        <a href="/">Staff workspace</a> · <a href="/operations">Daily work</a>
      </header>
      <h1 id="settings-title">Company content and branding</h1>
      <p>
        Synthetic local preview · Current company admin access required. No vendor/live-system
        change.
      </p>
      {result && scope ? (
        <CompanySettingsWorkspace
          initialState={result.state}
          instanceId={result.instanceId}
          scope={scope}
        />
      ) : (
        <section role="alert">
          <h2>Company settings unavailable</h2>
          <p>
            A current authorized admin read is required. Previous private data is not displayed.
          </p>
          <a href="/settings">Retry settings</a>
        </section>
      )}
    </main>
  );
}
