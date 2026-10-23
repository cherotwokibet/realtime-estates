import { DomainError } from './errors.js';
import { normalizeKenyanPhone } from './phone.js';
import type { TenantId } from './permissions.js';

/** Public configuration only. Provider credentials/signing keys never belong in a brand document. */
export interface TenantBrandConfig {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly companyName: string;
  readonly colors: {
    readonly primary: string;
    readonly secondary: string;
    readonly accent: string;
    readonly background: string;
  };
  readonly logo: { readonly url: string; readonly alt: string };
  readonly contact: { readonly email: string; readonly phone: string };
  readonly locale: 'en-KE';
  readonly currency: 'KES';
  readonly features: { readonly viewings: boolean; readonly customerAccounts: boolean };
}

function record(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new DomainError('INVALID_BRAND', `${label} must be an object.`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
  )
    throw new DomainError(
      'INVALID_BRAND',
      `${label} contains an unsupported field. Secrets are prohibited.`,
    );
  const result: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value'))
      throw new DomainError('INVALID_BRAND', `${label} requires explicit data fields.`);
    result[key] = field.value;
  }
  return result;
}
function text(value: unknown, label: string, max: number): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new DomainError('INVALID_BRAND', `${label} must be a short non-empty text value.`);
  return value.trim();
}
function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[\da-fA-F]{6}$/.test(value))
    throw new DomainError('INVALID_BRAND', 'Brand colors must be six-digit hexadecimal values.');
  return value.toLowerCase();
}
function safeLogoUrl(value: unknown): string {
  const url = text(value, 'Logo URL', 2048);
  if (/^\/[A-Za-z\d][A-Za-z\d/_\-.]*$/.test(url) && !url.split('/').includes('..')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.href;
  } catch {
    /* The configuration error below is intentionally generic. */
  }
  throw new DomainError(
    'INVALID_BRAND',
    'Use an HTTPS logo URL or a safe path under the website root.',
  );
}

/** Presentation palette only; no identity, contact or data-access context is inferred. */
export function validateBrandColors(input: unknown): TenantBrandConfig['colors'] {
  const colors = record(input, 'Colors', ['primary', 'secondary', 'accent', 'background']);
  return Object.freeze({
    primary: color(colors.primary),
    secondary: color(colors.secondary),
    accent: color(colors.accent),
    background: color(colors.background),
  });
}

export function validateTenantBrandConfig(input: unknown): TenantBrandConfig {
  const config = record(input, 'Brand config', [
    'tenantId',
    'slug',
    'companyName',
    'colors',
    'logo',
    'contact',
    'locale',
    'currency',
    'features',
  ]);
  const tenantId = text(config.tenantId, 'Tenant ID', 100);
  if (!/^[A-Za-z\d][A-Za-z\d_-]*$/.test(tenantId))
    throw new DomainError('INVALID_BRAND', 'Tenant ID contains unsupported characters.');
  const slug = text(config.slug, 'Slug', 63);
  if (!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug))
    throw new DomainError(
      'INVALID_BRAND',
      'Slug must contain lowercase words separated by single hyphens.',
    );
  const colors = validateBrandColors(config.colors);
  const logo = record(config.logo, 'Logo', ['url', 'alt']);
  const contact = record(config.contact, 'Contact', ['email', 'phone']);
  const features = record(config.features, 'Features', ['viewings', 'customerAccounts']);
  const email = text(contact.email, 'Contact email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new DomainError('INVALID_BRAND', 'A basic contact email address is required.');
  if (config.currency !== 'KES' || config.locale !== 'en-KE')
    throw new DomainError(
      'INVALID_BRAND',
      'This pilot supports the en-KE locale and KES currency.',
    );
  if (typeof features.viewings !== 'boolean' || typeof features.customerAccounts !== 'boolean')
    throw new DomainError('INVALID_BRAND', 'Feature values must be explicit booleans.');
  return Object.freeze({
    tenantId,
    slug,
    companyName: text(config.companyName, 'Company name', 120),
    colors,
    logo: Object.freeze({ url: safeLogoUrl(logo.url), alt: text(logo.alt, 'Logo alt text', 200) }),
    contact: Object.freeze({
      email,
      phone: normalizeKenyanPhone(text(contact.phone, 'Contact phone', 40)),
    }),
    locale: 'en-KE',
    currency: 'KES',
    features: Object.freeze({
      viewings: features.viewings,
      customerAccounts: features.customerAccounts,
    }),
  });
}
