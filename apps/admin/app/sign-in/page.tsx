import SignInPanel from '@realtor/browser-auth';
import { hostedWebIdentityConfig } from '../../lib/hosted-identity';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff sign in', robots: { index: false, follow: false } };
export default function SignIn() {
  const config = hostedWebIdentityConfig();
  return (
    <main id="main" tabIndex={-1}>
      {config ? (
        <SignInPanel config={config} title="Staff sign in" continueHref="/" />
      ) : (
        <section style={{ maxWidth: 480, margin: '4rem auto', padding: '1.5rem' }}>
          <h1>Staff sign-in is unavailable here.</h1>
          <p>Ask your workspace administrator to complete setup.</p>
          <a href="/">Back to workspace</a>
        </section>
      )}
    </main>
  );
}
