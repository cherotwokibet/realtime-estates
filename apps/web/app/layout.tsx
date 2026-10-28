import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { tenantBrand, tenantThemeCss } from '../lib/tenant';
import { publicSeoPolicy } from '../lib/public-seo-server';
export const metadata: Metadata = {
  title: `${tenantBrand.name} | Find your next place`,
  description: publicSeoPolicy.index
    ? 'Browse property details and itemized prices.'
    : 'Development preview of the independently owned Realtor platform.',
  robots: { index: publicSeoPolicy.index, follow: publicSeoPolicy.index },
  ...(publicSeoPolicy.origin ? { metadataBase: new URL(publicSeoPolicy.origin) } : {}),
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE" data-scroll-behavior="smooth">
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
