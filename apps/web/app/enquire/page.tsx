import IntakeWorkspace from '../../../shared/IntakeWorkspace';
import { publicIntakeConfig } from '../../lib/intake-config';
import { loadProperty } from '../../lib/catalogue-server';
import { tenantBrand } from '../../lib/tenant';
import '../../../shared/intake.css';
export const dynamic = 'force-dynamic';
export default async function Enquire({
  searchParams,
}: {
  searchParams: Promise<{ property?: string | string[] }>;
}) {
  let scope: ReturnType<typeof publicIntakeConfig> | undefined;
  try {
    scope = publicIntakeConfig(process.env);
  } catch {}
  const query = await searchParams;
  let selected: { id: string; title: string } | undefined;
  let invalid = false;
  if (query.property !== undefined) {
    if (!scope?.allowProperty || typeof query.property !== 'string') invalid = true;
    else {
      const result = await loadProperty(query.property);
      if (
        result.mode !== 'connected' ||
        result.dataKind !== 'synthetic' ||
        result.status !== 'found'
      )
        invalid = true;
      else selected = result.property;
    }
  }
  return (
    <main id="main" className="intake-shell">
      <header>
        <a href="/">{tenantBrand.name}</a>
        <a href="/">Explore homes →</a>
      </header>
      {scope && !invalid ? (
        <IntakeWorkspace
          key={selected?.id ?? 'general'}
          instanceId={scope.instanceId}
          showInbox={false}
          listingId={selected?.id ?? null}
          listingTitle={selected?.title}
        />
      ) : (
        <section className="intake-card">
          <h1>Enquiries are unavailable in this preview.</h1>
          <p>
            No contact details are collected here. Return to the catalogue to explore the
            demonstration.
          </p>
        </section>
      )}
    </main>
  );
}
export const metadata = { robots: { index: false, follow: false } };
