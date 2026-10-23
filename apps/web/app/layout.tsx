import type { Metadata } from 'next';
import './styles.css';
import { tenantBrand, tenantThemeCss } from '../lib/tenant';
export const metadata: Metadata = {
  title: `${tenantBrand.name} | Find your next place`,
  description: 'Development preview of the independently owned Realtor platform.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE">
      <body
        style={
          {
            ...tenantThemeCss,
            '--brand': tenantBrand.primary,
            '--accent': tenantBrand.accent,
          } as React.CSSProperties
        }
      >
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
