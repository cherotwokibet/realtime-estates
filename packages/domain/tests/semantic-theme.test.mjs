import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTenantTheme,
  tenantThemeCss,
  themeContrast,
  createBrandTheme,
  brandThemeCss,
} from '../dist/index.js';
const brand = {
  tenantId: 'synthetic-estates',
  slug: 'synthetic-estates',
  companyName: 'Synthetic Estates',
  colors: { primary: '#5E0202', secondary: '#194D3E', accent: '#B77B27', background: '#FFFDF8' },
  logo: { url: '/brands/synthetic/logo.svg', alt: 'Synthetic Estates logo' },
  contact: { email: 'demo@example.invalid', phone: '0700000000' },
  locale: 'en-KE',
  currency: 'KES',
  features: { viewings: true, customerAccounts: false },
};
test('palette-only themes match full public manifest presentation without inventing identity or contacts', () => {
  const palette = createBrandTheme(brand.colors),
    full = createTenantTheme(brand);
  assert.deepEqual(full.colors, palette.colors);
  assert.deepEqual(full.components, palette.components);
  assert.deepEqual(brandThemeCss(brand.colors), tenantThemeCss(brand));
  assert.equal(Object.hasOwn(palette, 'tenantId'), false);
  assert.equal(Object.hasOwn(palette, 'contact'), false);
  let reads = 0;
  const malicious = { ...brand.colors };
  Object.defineProperty(malicious, 'primary', {
    enumerable: true,
    get() {
      reads++;
      return '#ffffff';
    },
  });
  assert.throws(() => createBrandTheme(malicious));
  assert.equal(reads, 0);
  assert.throws(() => brandThemeCss({ ...brand.colors, apiKey: 'synthetic' }));
});

const componentPalettes = [
  brand.colors,
  { primary: '#10465b', secondary: '#305a49', accent: '#b76a35', background: '#ffffff' },
  { primary: '#ffffff', secondary: '#000000', accent: '#777777', background: '#000000' },
  { primary: '#949494', secondary: '#eeeeee', accent: '#aaaaaa', background: '#ffffff' },
];

test('component state text, boundaries and dual focus rings remain readable for both brands and palette extremes', () => {
  for (const colors of componentPalettes) {
    const theme = createBrandTheme(colors);
    for (const name of ['button', 'field', 'card']) {
      for (const state of ['default', 'hover', 'pressed', 'disabled', 'focus', 'selected']) {
        const pair = theme.components[name][state];
        assert.ok(themeContrast(pair.foreground, pair.background) >= 4.5, `${name}.${state} text`);
        assert.ok(
          themeContrast(pair.border, pair.background) >= 3 ||
            (name === 'button' && themeContrast(pair.background, theme.colors.surface) >= 3),
          `${name}.${state} boundary`,
        );
      }
    }
    for (const [name, pair] of Object.entries(theme.components.feedback)) {
      assert.ok(themeContrast(pair.foreground, pair.background) >= 4.5, `feedback.${name} text`);
      assert.ok(
        themeContrast(pair.border, pair.background) >= 3 ||
          themeContrast(pair.background, theme.colors.surface) >= 3,
        `feedback.${name} boundary`,
      );
    }
    const focus = theme.components.focus;
    assert.ok(themeContrast(focus.color, focus.gapColor) >= 3);
    assert.ok(
      Math.max(
        themeContrast(focus.color, theme.colors.background),
        themeContrast(focus.gapColor, theme.colors.background),
      ) >= 3,
    );
    assert.equal(focus.width, 3);
    assert.equal(focus.offset, 3);
  }
});

test('component states use semantic feedback and retain the original numeric scale contracts', () => {
  for (const colors of componentPalettes.slice(0, 2)) {
    const theme = createBrandTheme(colors);
    assert.equal(theme.policy, 'semantic-theme-v1');
    assert.deepEqual(theme.spacing, { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 });
    assert.deepEqual(theme.radius, { control: 8, card: 12 });
    assert.equal(theme.typography.bodySize, 16);
    assert.equal(theme.typography.bodyLineHeight, 24);
    for (const name of ['button', 'field']) {
      assert.equal(theme.components[name].minHeight, theme.minimumControlSize);
      assert.equal(theme.components[name].radius, theme.radius.control);
      assert.equal(theme.components[name].paddingX, theme.spacing.md);
      assert.equal(theme.components[name].paddingY, theme.spacing.sm);
      assert.equal(theme.components[name].fontSize, theme.typography.bodySize);
    }
    assert.equal(theme.components.card.radius, theme.radius.card);
    assert.equal(theme.components.card.paddingX, theme.spacing.lg);
    assert.equal(theme.components.button.default.background, theme.colors.primary);
    assert.equal(theme.components.button.hover.background, theme.colors.secondary);
    assert.notDeepEqual(theme.components.button.default, theme.components.button.hover);
    assert.notDeepEqual(theme.components.button.hover, theme.components.button.pressed);
    assert.notDeepEqual(theme.components.button.default, theme.components.button.disabled);
    assert.notEqual(theme.components.feedback.error.foreground, theme.colors.primary);
    assert.equal(theme.components.feedback.error.foreground, theme.colors.onErrorSurface);
    assert.equal(theme.components.field.selected.background, theme.colors.surface);
    assert.deepEqual(theme.components.feedback.selected, theme.components.button.selected);
  }
});

test('every component state and feedback object is detached and deeply frozen', () => {
  const colors = { ...brand.colors },
    theme = createBrandTheme(colors);
  const before = JSON.stringify(theme.components);
  colors.primary = '#ffffff';
  const inspect = (value) => {
    assert.ok(Object.isFrozen(value));
    for (const nested of Object.values(value))
      if (nested && typeof nested === 'object') inspect(nested);
  };
  inspect(theme.components);
  assert.throws(() => {
    theme.components.button.disabled.foreground = '#ffffff';
  }, TypeError);
  assert.throws(() => {
    theme.components.feedback.error = theme.components.feedback.help;
  }, TypeError);
  assert.equal(JSON.stringify(theme.components), before);
});

test('fixed component CSS aliases match numeric native tokens for all states and feedback', () => {
  for (const colors of componentPalettes.slice(0, 2)) {
    const theme = createBrandTheme(colors),
      css = brandThemeCss(colors);
    for (const name of ['button', 'field', 'card']) {
      for (const state of ['default', 'hover', 'pressed', 'disabled', 'focus', 'selected'])
        for (const part of ['background', 'foreground', 'border'])
          assert.equal(css[`--${name}-${state}-${part}`], theme.components[name][state][part]);
      for (const [metric, suffix] of [
        ['minHeight', 'min-height'],
        ['paddingX', 'padding-x'],
        ['paddingY', 'padding-y'],
        ['radius', 'radius'],
        ['fontSize', 'font-size'],
        ['lineHeight', 'line-height'],
      ])
        assert.equal(css[`--${name}-${suffix}`], `${theme.components[name][metric]}px`);
      assert.equal(css[`--${name}-font-weight`], String(theme.components[name].fontWeight));
    }
    for (const feedback of ['help', 'error', 'selected'])
      for (const part of ['background', 'foreground', 'border'])
        assert.equal(
          css[`--feedback-${feedback}-${part}`],
          theme.components.feedback[feedback][part],
        );
    assert.equal(css['--focus-ring-color'], theme.components.focus.color);
    assert.equal(css['--focus-ring-gap-color'], theme.components.focus.gapColor);
    assert.equal(css['--focus-ring-width'], `${theme.components.focus.width}px`);
    assert.equal(css['--focus-ring-offset'], `${theme.components.focus.offset}px`);
    assert.equal(css['--color-primary'], theme.colors.primary);
    assert.equal(css['--control-min-size'], '48px');
  }
});
test('sRGB contrast uses exact black/white references and does not round borderline failures', () => {
  assert.equal(themeContrast('#000000', '#ffffff'), 21);
  assert.equal(themeContrast('#ffffff', '#000000'), 21);
  assert.equal(themeContrast('#123456', '#123456'), 1);
  const borderline = themeContrast('#777777', '#ffffff');
  assert.ok(borderline > 4.47 && borderline < 4.5);
  for (const color of ['white', '#fff', 'rgb(0,0,0)', '#ffffff;display:none'])
    assert.throws(() => themeContrast(color, '#ffffff'));
});
test('semantic themes keep text readable for both brands, light/dark extremes and midtone accents', () => {
  for (const colors of [
    brand.colors,
    { primary: '#10465b', secondary: '#305a49', accent: '#b76a35', background: '#ffffff' },
    { primary: '#ffffff', secondary: '#000000', accent: '#777777', background: '#000000' },
    { primary: '#777777', secondary: '#808080', accent: '#aaaaaa', background: '#ffffff' },
  ]) {
    const theme = createTenantTheme({ ...brand, colors });
    for (const key of ['primary', 'secondary', 'accent', 'background', 'surface']) {
      const on = 'on' + key[0].toUpperCase() + key.slice(1);
      assert.ok(themeContrast(theme.colors[key], theme.colors[on]) >= 4.5, `${key} text must pass`);
    }
    assert.ok(themeContrast(theme.colors.link, theme.colors.background) >= 4.5);
    assert.ok(themeContrast(theme.colors.outline, theme.colors.background) >= 3);
  }
  const borderline = createTenantTheme({
    ...brand,
    colors: { ...brand.colors, primary: '#777777', background: '#ffffff' },
  });
  assert.equal(borderline.colors.link, '#000000');
  assert.equal(borderline.colors.primary, '#777777');
});
test('CSS and numeric native-facing tokens share fixed semantic values without CSS injection', () => {
  const theme = createTenantTheme(brand),
    css = tenantThemeCss(brand);
  assert.equal(css['--color-primary'], theme.colors.primary);
  assert.equal(css['--color-on-primary'], theme.colors.onPrimary);
  assert.equal(css['--space-md'], `${theme.spacing.md}px`);
  assert.equal(css['--font-body-size'], `${theme.typography.bodySize}px`);
  assert.equal(css['--control-min-size'], '48px');
  assert.equal(theme.minimumControlSize, 48);
  assert.ok(Object.isFrozen(css));
  for (const part of [theme, theme.colors, theme.spacing, theme.typography, theme.radius])
    assert.ok(Object.isFrozen(part));
  const other = createTenantTheme({
    ...brand,
    tenantId: 'second',
    slug: 'second',
    colors: { ...brand.colors, primary: '#10465b' },
  });
  assert.equal(other.tenantId, 'second');
  assert.notEqual(other.colors.primary, theme.colors.primary);
  assert.deepEqual(other.spacing, theme.spacing);
  const malicious = { ...brand, colors: { ...brand.colors, primary: '#ffffff; color:red' } };
  assert.throws(() => tenantThemeCss(malicious));
  assert.throws(() => createTenantTheme({ ...brand, apiKey: 'synthetic-private-field' }));
  assert.ok(!JSON.stringify(css).includes(brand.companyName));
  assert.ok(!JSON.stringify(css).includes(brand.contact.email));
});
