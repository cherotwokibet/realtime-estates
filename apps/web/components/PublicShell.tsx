import Link from 'next/link';
import { tenantBrand } from '../lib/tenant';
import { publicIntakeConfig } from '../lib/intake-config';
function intakeEnabled() {
  try {
    publicIntakeConfig(process.env);
    return true;
  } catch {
    return false;
  }
}

export function PublicHeader({
  purpose,
  current,
  brand = tenantBrand,
}: {
  purpose?: string;
  current?: 'company' | 'contact';
  brand?: typeof tenantBrand;
}) {
  return (
    <header className="site-header container">
      <Link href="/" className="brand" aria-label={brand.name + ' home'}>
        <span className="brand-mark">{brand.initials}</span>
        <span>
          {brand.name}
          <small>Find your next place</small>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/?purpose=rent" aria-current={purpose === 'rent' ? 'page' : undefined}>
          Rent
        </Link>
        <Link href="/?purpose=sale" aria-current={purpose === 'sale' ? 'page' : undefined}>
          Buy
        </Link>
        <Link href="/company" aria-current={current === 'company' ? 'page' : undefined}>
          Company
        </Link>
        <Link href="/contact" aria-current={current === 'contact' ? 'page' : undefined}>
          Contact
        </Link>
      </nav>
      <Link href={intakeEnabled() ? '/enquire' : '/'} className="header-link">
        {intakeEnabled() ? 'Test a general enquiry →' : 'Explore properties →'}
      </Link>
    </header>
  );
}
export function CatalogueBanner({ mode }: { mode: 'demo' | 'connected' | 'unavailable' }) {
  return (
    <div className="preview">
      <span className="preview-dot" />
      {intakeEnabled()
        ? 'Synthetic preview · Test enquiries enabled. No real property availability or viewing bookings.'
        : mode === 'demo'
          ? 'Design preview · Sample listings and illustrative AI images. Enquiries are disabled.'
          : mode === 'connected'
            ? 'API-connected development preview · Enquiries and viewing requests are disabled.'
            : 'Development preview · Property service unavailable. Enquiries are disabled.'}
    </div>
  );
}
export function PublicFooter({
  mode,
  brand = tenantBrand,
}: {
  mode: 'demo' | 'connected' | 'unavailable';
  brand?: typeof tenantBrand;
}) {
  return (
    <footer className="site-footer">
      <div className="container footer-top">
        <Link href="/" className="brand">
          <span className="brand-mark">{brand.initials}</span>
          <span>
            {brand.name}
            <small>Better spaces. Clearer choices.</small>
          </span>
        </Link>
        <nav aria-label="Footer navigation">
          <Link href="/?purpose=rent">Homes to rent</Link>
          <Link href="/?purpose=sale">Homes to buy</Link>
          <Link href="/#how">Our approach</Link>
          <Link href="/company">Company</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </div>
      <div className="container footer-bottom">
        <p>
          {mode === 'demo'
            ? 'Independent design preview · Synthetic properties and illustrative AI concepts.'
            : 'Development preview · Check availability and costs with the agency before committing.'}
        </p>
        <span>Contact details and reviewed policies are pending.</span>
      </div>
    </footer>
  );
}
export function CatalogueProblem({
  message,
  incomplete = false,
}: {
  message: string;
  incomplete?: boolean;
}) {
  return (
    <section className="catalogue-problem" aria-labelledby="catalogue-problem-title">
      <span className="eyebrow">{incomplete ? 'DETAILS NOT VERIFIED' : 'PLEASE TRY AGAIN'}</span>
      <h2 id="catalogue-problem-title">
        {incomplete
          ? 'We couldn’t confirm this property.'
          : 'Properties are temporarily unavailable.'}
      </h2>
      <p role="alert">{message}</p>
      <p>Your search has not been replaced with sample results.</p>
      <a className="primary" href="/">
        Try loading properties again
      </a>
    </section>
  );
}
