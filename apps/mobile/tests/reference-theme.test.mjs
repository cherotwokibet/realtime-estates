import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrandTheme, themeContrast } from '@realtor/domain';
import { getDemoTheme } from '@realtor/demo';
import { createReferenceCatalogueStyles } from '../dist/tests/src/reference-theme.js';

test('reference native controls share both configured company themes and accessible component states', () => {
  for (const theme of [
    getDemoTheme('realtime-estates'),
    getDemoTheme('sample-homes'),
    createBrandTheme({
      primary: '#ffffff',
      secondary: '#ffff00',
      accent: '#000000',
      background: '#000000',
    }),
  ]) {
    const styles = createReferenceCatalogueStyles(theme);
    assert.equal(styles.button.minHeight, theme.minimumControlSize);
    assert.equal(styles.input.minHeight, theme.minimumControlSize);
    assert.ok(styles.button.minHeight >= 48);
    assert.equal(styles.button.borderRadius, theme.radius.control);
    assert.equal(styles.card.borderRadius, theme.radius.card);
    assert.equal(styles.copy.fontSize, theme.typography.bodySize);
    assert.equal(styles.notice.fontSize, theme.typography.smallSize);
    for (const [surface, text] of [
      [styles.button, styles.buttonText],
      [styles.buttonHovered, styles.buttonHoveredText],
      [styles.buttonPressed, styles.buttonPressedText],
      [styles.buttonDisabled, styles.buttonDisabledText],
    ]) {
      assert.ok(themeContrast(surface.backgroundColor, text.color) >= 4.5);
    }
    assert.ok(themeContrast(styles.input.backgroundColor, styles.input.color) >= 4.5);
    assert.ok(themeContrast(styles.header.backgroundColor, styles.brand.color) >= 4.5);
    assert.ok(themeContrast(styles.error.backgroundColor, styles.error.color) >= 4.5);
    assert.ok(
      themeContrast(styles.cardSelected.backgroundColor, styles.cardSelected.borderColor) >= 3,
    );
    assert.equal(styles.buttonDisabled.opacity, undefined);
    assert.equal(styles.inputDisabled.opacity, undefined);
  }
  assert.notEqual(
    createReferenceCatalogueStyles(getDemoTheme('realtime-estates')).button.backgroundColor,
    createReferenceCatalogueStyles(getDemoTheme('sample-homes')).button.backgroundColor,
  );
});
test('reference native focus preserves pressed colors with a shared outer ring and contrasting gap', () => {
  const theme = getDemoTheme('sample-homes'),
    styles = createReferenceCatalogueStyles(theme);
  assert.equal(styles.focused.outlineWidth, theme.components.focus.width);
  assert.equal(styles.focused.outlineOffset, theme.components.focus.offset);
  assert.equal(styles.focused.outlineColor, theme.components.focus.color);
  assert.equal(styles.focused.borderColor, undefined);
  assert.equal(styles.focused.backgroundColor, undefined);
  assert.ok(themeContrast(styles.focused.outlineColor, styles.focused.boxShadow[0].color) >= 3);
  assert.equal(styles.focused.boxShadow[0].spreadDistance, theme.components.focus.offset);
  assert.ok(
    themeContrast(styles.buttonPressed.backgroundColor, styles.buttonPressedText.color) >= 4.5,
  );
});
