import Link from 'next/link';
import { PublicHeader, PublicFooter } from '../components/PublicShell';
export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="container catalogue-problem">
        <span className="eyebrow">PROPERTY NOT FOUND</span>
        <h1>This property isn’t available here.</h1>
        <p>It may no longer be published, or the link may be incorrect.</p>
        <Link className="primary" href="/">
          Explore properties
        </Link>
      </main>
      <PublicFooter mode="unavailable" />
    </>
  );
}
