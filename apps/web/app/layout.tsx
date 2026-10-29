import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { publicSeoPolicy } from '../lib/public-seo-server';
import { approvedPresentation, readApprovedCompany } from '../lib/approved-company';
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${approvedPresentation(await readApprovedCompany()).brand.name} | Find your next place`,
    description: publicSeoPolicy.index
      ? 'Browse property details and itemized prices.'
      : 'Development preview of the independently owned Realtor platform.',
    robots: { index: publicSeoPolicy.index, follow: publicSeoPolicy.index },
    ...(publicSeoPolicy.origin ? { metadataBase: new URL(publicSeoPolicy.origin) } : {}),
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const presentation = approvedPresentation(await readApprovedCompany());
  return (
    <html lang="en-KE" data-scroll-behavior="smooth">
      <body
        style={
          {
            ...presentation.css,
            '--brand': presentation.brand.primary,
            '--accent': presentation.brand.accent,
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
