import Link from 'next/link';
import { PublicHeader, PublicFooter } from '../components/PublicShell';
export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" tabIndex={-1} className="container catalogue-problem">
        <span className="eyebrow">PAGE NOT FOUND</span>
        <h1>This page isn’t available here.</h1>
        <p>The link may be incorrect, or this property or profile may no longer be published.</p>
        <Link className="primary" href="/">
          Explore properties
        </Link>
      </main>
      <PublicFooter mode="unavailable" />
    </>
  );
}
