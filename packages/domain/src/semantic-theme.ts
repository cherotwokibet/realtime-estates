import { DomainError } from './errors.js';
import { validateBrandColors, validateTenantBrandConfig } from './branding.js';

function rgb(input: string): number[] {
  if (typeof input !== 'string' || !/^#[a-f0-9]{6}$/i.test(input))
    throw new DomainError('INVALID_THEME_COLOR', 'A six-digit hexadecimal color is required.');
  return [1, 3, 5].map((offset) => parseInt(input.slice(offset, offset + 2), 16) / 255);
}
function luminance(input: string): number {
  const channels = rgb(input).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
/** WCAG sRGB contrast, without rounding a failing ratio into a passing threshold. */
export function themeContrast(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function foreground(background: string): '#000000' | '#ffffff' {
  return themeContrast('#000000', background) >= themeContrast('#ffffff', background)
    ? '#000000'
    : '#ffffff';
}
/** Public presentation only. A theme never selects or authorizes company data. */
export function createTenantTheme(input: unknown) {
  const brand = validateTenantBrandConfig(input);
  return Object.freeze({ ...createBrandTheme(brand.colors), tenantId: brand.tenantId });
}
/** Palette-only composition does not fabricate company identity or contact information. */
export function createBrandTheme(input: unknown) {
  const { primary, secondary, accent, background } = validateBrandColors(input);
  const onBackground = foreground(background);
  return Object.freeze({
    policy: 'semantic-theme-v1' as const,
    colors: Object.freeze({
      primary,
      onPrimary: foreground(primary),
      secondary,
      onSecondary: foreground(secondary),
      accent,
      onAccent: foreground(accent),
      background,
      onBackground,
      surface: '#ffffff',
      onSurface: '#17212b',
      link: themeContrast(primary, background) >= 4.5 ? primary : onBackground,
      outline: onBackground,
    }),
    spacing: Object.freeze({ xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 }),
    radius: Object.freeze({ control: 8, card: 12 }),
    typography: Object.freeze({
      bodySize: 16,
      bodyLineHeight: 24,
      smallSize: 14,
      smallLineHeight: 20,
      titleSize: 32,
      titleLineHeight: 40,
      bodyWeight: 400,
      strongWeight: 600,
    }),
    minimumControlSize: 48,
  });
}
export type TenantTheme = ReturnType<typeof createTenantTheme>;
/** Fixed variable names/units; arbitrary company strings never enter CSS. */
export function tenantThemeCss(input: unknown): Readonly<Record<string, string>> {
  return cssVariables(createTenantTheme(input));
}
export function brandThemeCss(input: unknown): Readonly<Record<string, string>> {
  return cssVariables(createBrandTheme(input));
}
function cssVariables(
  theme: ReturnType<typeof createBrandTheme>,
): Readonly<Record<string, string>> {
  const variables: Record<string, string> = {};
  for (const [name, color] of Object.entries(theme.colors))
    variables[`--color-${name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}`] = color;
  for (const [name, value] of Object.entries(theme.spacing))
    variables[`--space-${name}`] = `${value}px`;
  variables['--radius-control'] = `${theme.radius.control}px`;
  variables['--radius-card'] = `${theme.radius.card}px`;
  variables['--font-body-size'] = `${theme.typography.bodySize}px`;
  variables['--font-body-line-height'] = `${theme.typography.bodyLineHeight}px`;
  variables['--font-small-size'] = `${theme.typography.smallSize}px`;
  variables['--font-small-line-height'] = `${theme.typography.smallLineHeight}px`;
  variables['--font-title-size'] = `${theme.typography.titleSize}px`;
  variables['--font-title-line-height'] = `${theme.typography.titleLineHeight}px`;
  variables['--font-body-weight'] = String(theme.typography.bodyWeight);
  variables['--font-strong-weight'] = String(theme.typography.strongWeight);
  variables['--control-min-size'] = `${theme.minimumControlSize}px`;
  return Object.freeze(variables);
}
