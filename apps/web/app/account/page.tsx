import CustomerAccount from '../../components/CustomerAccount';
import { customerBridge } from '../../lib/customer-runtime';
import { loadProperty } from '../../lib/catalogue-server';
import {
  ConnectedPublicHeader,
  ConnectedPublicFooter,
} from '../../components/ConnectedPublicShell';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your saved homes', robots: { index: false, follow: false } };
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  let candidate: null | { id: string; title: string } = null;
  if (typeof query.property === 'string' && /^[0-9a-f-]{36}$/.test(query.property)) {
    const r = await loadProperty(query.property);
    if (r.mode !== 'error' && r.status === 'found')
      candidate = { id: r.property.id, title: r.property.title };
  }
  const bridge = customerBridge();
  return (
    <>
      <ConnectedPublicHeader />
      <main id="main" tabIndex={-1} className="container detail-page">
        {bridge ? (
          <CustomerAccount candidate={candidate} tenantId={bridge.tenantId} />
        ) : (
          <>
            <h1>Customer accounts are unavailable here.</h1>
            <p>You can continue browsing public properties.</p>
          </>
        )}
      </main>
      <ConnectedPublicFooter mode="connected" />
    </>
  );
}
