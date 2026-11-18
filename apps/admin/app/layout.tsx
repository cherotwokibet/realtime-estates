import './intake.css';
import './styles.css';
import './reviews.css';
import './gallery.css';
import './enquiries.css';
import './creation.css';
import './component-theme.css';
import { getDemoThemeCss, resolveDemoTenantSlug } from '@realtor/demo';
export const metadata = {
  title:
    process.env.HOSTED_STAFF_API_ORIGIN !== undefined
      ? 'Staff workspace'
      : 'Staff workspace preview',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const theme = getDemoThemeCss(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <html lang="en-KE">
      <body style={theme as React.CSSProperties}>{children}</body>
    </html>
  );
}
