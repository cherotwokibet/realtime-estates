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
export type ComponentState = 'default' | 'hover' | 'pressed' | 'disabled' | 'focus' | 'selected';
export interface ComponentColorTokens {
  readonly background: string;
  readonly foreground: string;
  readonly border: string;
}
export type ComponentTokens = Readonly<Record<ComponentState, ComponentColorTokens>> &
  Readonly<{
    minHeight: number;
    paddingX: number;
    paddingY: number;
    radius: number;
    fontSize: number;
    lineHeight: number;
    fontWeight: number;
  }>;
export interface ComponentThemeTokens {
  readonly button: ComponentTokens;
  readonly field: ComponentTokens;
  readonly card: ComponentTokens;
  readonly feedback: Readonly<Record<'help' | 'error' | 'selected', ComponentColorTokens>>;
  readonly focus: Readonly<{ color: string; gapColor: string; width: number; offset: number }>;
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
  const colors = Object.freeze({
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
    mutedSurface: '#eef1f4',
    onMutedSurface: '#46515c',
    border: '#66717c',
    error: '#b42318',
    errorSurface: '#fff1f0',
    onErrorSurface: '#7a271a',
    link: themeContrast(primary, background) >= 4.5 ? primary : onBackground,
    outline: onBackground,
  });
  const spacing = Object.freeze({ xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 });
  const radius = Object.freeze({ control: 8, card: 12 });
  const typography = Object.freeze({
    bodySize: 16,
    bodyLineHeight: 24,
    smallSize: 14,
    smallLineHeight: 20,
    titleSize: 32,
    titleLineHeight: 40,
    bodyWeight: 400,
    strongWeight: 600,
  });
  const minimumControlSize = 48;
  const pair = (background: string, foreground: string, border: string): ComponentColorTokens =>
    Object.freeze({ background, foreground, border });
  const brandBorder = (fill: string, surface: string = colors.surface) =>
    themeContrast(fill, surface) >= 3 ? fill : colors.onSurface;
  const ordinary = pair(colors.surface, colors.onSurface, colors.border);
  const hover = pair(colors.mutedSurface, colors.onSurface, colors.onSurface);
  const disabled = pair(colors.mutedSurface, colors.onMutedSurface, colors.border);
  const focused = pair(colors.surface, colors.onSurface, colors.onSurface);
  const selected = pair(colors.primary, colors.onPrimary, brandBorder(colors.primary));
  const selectedSurface = pair(colors.surface, colors.onSurface, brandBorder(colors.primary));
  const controlMetrics = Object.freeze({
    minHeight: minimumControlSize,
    paddingX: spacing.md,
    paddingY: spacing.sm,
    radius: radius.control,
    fontSize: typography.bodySize,
    lineHeight: typography.bodyLineHeight,
    fontWeight: typography.strongWeight,
  });
  const components: ComponentThemeTokens = Object.freeze({
    button: Object.freeze({
      ...controlMetrics,
      default: selected,
      hover: pair(colors.secondary, colors.onSecondary, brandBorder(colors.secondary)),
      pressed: pair(colors.onSurface, colors.surface, colors.onSurface),
      disabled,
      focus: selected,
      selected,
    }),
    field: Object.freeze({
      ...controlMetrics,
      fontWeight: typography.bodyWeight,
      default: ordinary,
      hover,
      pressed: hover,
      disabled,
      focus: focused,
      selected: selectedSurface,
    }),
    card: Object.freeze({
      ...controlMetrics,
      minHeight: 0,
      paddingX: spacing.lg,
      paddingY: spacing.lg,
      radius: radius.card,
      fontWeight: typography.bodyWeight,
      default: ordinary,
      hover,
      pressed: focused,
      disabled,
      focus: focused,
      selected: pair(
        colors.mutedSurface,
        colors.onSurface,
        brandBorder(colors.primary, colors.mutedSurface),
      ),
    }),
    feedback: Object.freeze({
      help: pair(colors.surface, colors.onMutedSurface, colors.border),
      error: pair(colors.errorSurface, colors.onErrorSurface, colors.error),
      selected,
    }),
    focus: Object.freeze({
      color: colors.onSurface,
      gapColor: colors.surface,
      width: 3,
      offset: 3,
    }),
  });
  return Object.freeze({
    policy: 'semantic-theme-v1' as const,
    colors,
    spacing,
    radius,
    typography,
    minimumControlSize,
    components,
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
  for (const name of ['button', 'field', 'card'] as const) {
    const component = theme.components[name];
    for (const state of ['default', 'hover', 'pressed', 'disabled', 'focus', 'selected'] as const)
      for (const [part, color] of Object.entries(component[state]))
        variables[`--${name}-${state}-${part}`] = color;
    for (const [property, suffix] of [
      ['minHeight', 'min-height'],
      ['paddingX', 'padding-x'],
      ['paddingY', 'padding-y'],
      ['radius', 'radius'],
      ['fontSize', 'font-size'],
      ['lineHeight', 'line-height'],
    ] as const)
      variables[`--${name}-${suffix}`] = `${component[property]}px`;
    variables[`--${name}-font-weight`] = String(component.fontWeight);
  }
  for (const feedback of ['help', 'error', 'selected'] as const)
    for (const [part, color] of Object.entries(theme.components.feedback[feedback]))
      variables[`--feedback-${feedback}-${part}`] = color;
  variables['--focus-ring-color'] = theme.components.focus.color;
  variables['--focus-ring-gap-color'] = theme.components.focus.gapColor;
  variables['--focus-ring-width'] = `${theme.components.focus.width}px`;
  variables['--focus-ring-offset'] = `${theme.components.focus.offset}px`;
  return Object.freeze(variables);
}
