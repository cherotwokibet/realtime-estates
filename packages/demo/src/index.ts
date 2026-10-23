import { createBrandTheme, brandThemeCss } from '@realtor/domain';
export type DemoProperty = {
  id: string;
  tenantSlug: string;
  title: string;
  neighbourhood: string;
  county: string;
  purpose: 'rent' | 'sale';
  type: 'apartment' | 'bedsitter' | 'studio' | 'maisonette' | 'land';
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number;
  priceMinor: number;
  rentalPeriod: 'month' | null;
  description: string;
  amenities: readonly string[];
};
export const demoBrands = {
  'realtime-estates': {
    name: 'Realtime Estates Ltd',
    primary: '#5e0202',
    accent: '#b77b27',
    initials: 'RE',
  },
  'sample-homes': {
    name: 'Sample Homes — test company',
    primary: '#10465b',
    accent: '#b76a35',
    initials: 'SH',
  },
} as const;
export type DemoTenantSlug = keyof typeof demoBrands;
/** This registry configures synthetic previews only. Protected data needs server-verified identity. */
export function resolveDemoTenantSlug(value: unknown = 'realtime-estates'): DemoTenantSlug {
  if (typeof value !== 'string' || !Object.hasOwn(demoBrands, value))
    throw new Error('Unknown configured company. Set a validated TENANT_SLUG.');
  return value as DemoTenantSlug;
}
export function getDemoBrand(slug: string) {
  return demoBrands[resolveDemoTenantSlug(slug)];
}
function demoPalette(slug: string) {
  const brand = getDemoBrand(slug);
  return {
    primary: brand.primary,
    secondary: slug === 'realtime-estates' ? '#194d3e' : '#305a49',
    accent: brand.accent,
    background: '#ffffff',
  };
}
/** Synthetic presentation configuration only; no invented company contacts or protected scope. */
export function getDemoTheme(slug: string) {
  return createBrandTheme(demoPalette(slug));
}
export function getDemoThemeCss(slug: string) {
  return brandThemeCss(demoPalette(slug));
}
export const demoProperties: readonly DemoProperty[] = [
  {
    id: 'demo-langata-1',
    tenantSlug: 'realtime-estates',
    title: 'Room to settle in',
    neighbourhood: 'Lang’ata',
    county: 'Nairobi',
    purpose: 'rent',
    type: 'bedsitter',
    bedrooms: 0,
    bathrooms: 1,
    areaSqm: 24,
    priceMinor: 1250000,
    rentalPeriod: 'month',
    description:
      'Synthetic development listing for testing discovery and exact pricing. This is not an available property.',
    amenities: ['Water storage', 'Gated compound'],
  },
  {
    id: 'demo-ruaka-1',
    tenantSlug: 'realtime-estates',
    title: 'A brighter everyday',
    neighbourhood: 'Ruaka',
    county: 'Kiambu',
    purpose: 'rent',
    type: 'studio',
    bedrooms: 0,
    bathrooms: 1,
    areaSqm: 32,
    priceMinor: 1800000,
    rentalPeriod: 'month',
    description:
      'Synthetic studio used for interface and filter testing. No real property or agent is represented.',
    amenities: ['Balcony', 'Water storage'],
  },
  {
    id: 'demo-kilimani-1',
    tenantSlug: 'realtime-estates',
    title: 'Space for your next chapter',
    neighbourhood: 'Kilimani',
    county: 'Nairobi',
    purpose: 'rent',
    type: 'apartment',
    bedrooms: 2,
    bathrooms: 2,
    areaSqm: 96,
    priceMinor: 6500000,
    rentalPeriod: 'month',
    description:
      'Synthetic two-bedroom example. Demonstrates structured bathrooms and amenities without importing vendor customer data.',
    amenities: ['Parking', 'Lift', 'Balcony'],
  },
  {
    id: 'demo-kitengela-1',
    tenantSlug: 'realtime-estates',
    title: 'A place to grow',
    neighbourhood: 'Kitengela',
    county: 'Kajiado',
    purpose: 'sale',
    type: 'maisonette',
    bedrooms: 4,
    bathrooms: 3,
    areaSqm: 210,
    priceMinor: 1250000000,
    rentalPeriod: null,
    description:
      'Synthetic sale example with an exact KES price. No payment collection or live availability.',
    amenities: ['Garden', 'Parking'],
  },
  {
    id: 'sample-property-1',
    tenantSlug: 'sample-homes',
    title: 'Second-company isolation fixture',
    neighbourhood: 'Test neighbourhood',
    county: 'Test county',
    purpose: 'rent',
    type: 'apartment',
    bedrooms: 1,
    bathrooms: 1,
    areaSqm: 48,
    priceMinor: 2000000,
    rentalPeriod: 'month',
    description: 'Only for demonstrating configuration and isolation in development.',
    amenities: ['Test amenity'],
  },
];
export function propertiesForCompany(slug: string): readonly DemoProperty[] {
  return demoProperties.filter((p) => p.tenantSlug === slug);
}
