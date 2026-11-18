import SignInPanel from '@realtor/browser-auth';
import { hostedWebIdentityConfig } from '../../lib/hosted-identity';
import {
  ConnectedPublicHeader,
  ConnectedPublicFooter,
} from '../../components/ConnectedPublicShell';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in', robots: { index: false, follow: false } };
export default function SignIn() {
  const config = hostedWebIdentityConfig();
  return (
    <>
      <ConnectedPublicHeader />
      <main id="main" tabIndex={-1} className="container detail-page">
        {config ? (
          <SignInPanel config={config} continueHref="/account" />
        ) : (
          <section>
            <h1>Sign-in is unavailable here.</h1>
            <p>You can continue browsing public properties.</p>
            <a href="/">Browse properties</a>
          </section>
        )}
      </main>
      <ConnectedPublicFooter mode="connected" />
    </>
  );
}
