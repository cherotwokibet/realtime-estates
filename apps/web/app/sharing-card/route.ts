import { createElement } from 'react';
import { ImageResponse } from 'next/og';
import { tenantBrand, tenantThemeCss } from '../../lib/tenant';
import { publicSeoPolicy } from '../../lib/public-seo-server';
export const dynamic = 'force-dynamic';
export function GET() {
  return new ImageResponse(
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: tenantBrand.primary,
          color: tenantThemeCss['--color-on-primary'],
          padding: 70,
          fontSize: 64,
        },
      },
      createElement(
        'div',
        { style: { display: 'flex', fontSize: 28, marginBottom: 32 } },
        publicSeoPolicy.index ? 'PROPERTY CATALOGUE' : 'SYNTHETIC DEVELOPMENT PREVIEW',
      ),
      createElement('div', { style: { display: 'flex' } }, tenantBrand.name),
      createElement(
        'div',
        { style: { display: 'flex', fontSize: 30, marginTop: 32 } },
        publicSeoPolicy.index
          ? 'Property details · Clear pricing'
          : 'Illustrative catalogue · No real availability',
      ),
    ),
    { width: 1200, height: 630 },
  );
}
