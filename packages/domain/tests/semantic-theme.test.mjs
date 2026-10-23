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
