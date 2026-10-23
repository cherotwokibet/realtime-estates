import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoBrand, getDemoTheme, getDemoThemeCss } from '../dist/index.js';
import { themeContrast } from '@realtor/domain';
test('both configured synthetic brands share semantic scales and retain separate readable primary actions', () => {
  const first = getDemoTheme('realtime-estates'),
    second = getDemoTheme('sample-homes');
  assert.notEqual(first.colors.primary, second.colors.primary);
  assert.deepEqual(first.spacing, second.spacing);
  assert.deepEqual(first.typography, second.typography);
  for (const slug of ['realtime-estates', 'sample-homes']) {
    const brand = getDemoBrand(slug),
      theme = getDemoTheme(slug),
      css = getDemoThemeCss(slug);
    assert.equal(theme.colors.primary, brand.primary);
    assert.equal(css['--color-on-primary'], theme.colors.onPrimary);
    assert.equal(css['--control-min-size'], String(theme.minimumControlSize) + 'px');
    assert.ok(themeContrast(theme.colors.primary, theme.colors.onPrimary) >= 4.5);
    assert.ok(Object.isFrozen(theme.colors));
    assert.equal(Object.hasOwn(theme, 'contact'), false);
    assert.equal(Object.hasOwn(theme, 'tenantId'), false);
  }
});
test('presentation theme lookup rejects unknown and inherited company names', () => {
  for (const slug of ['constructor', '__proto__', 'unknown', 'REALTIME-ESTATES']) {
    assert.throws(() => getDemoTheme(slug));
    assert.throws(() => getDemoThemeCss(slug));
  }
});
