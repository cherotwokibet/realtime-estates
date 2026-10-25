import type { createBrandTheme, ComponentColorTokens } from '@realtor/domain';
import type { TextStyle, ViewStyle } from 'react-native';

/** Presentation only; the caller's already validated build context still selects the company. */
export function createReferenceCatalogueStyles(theme: ReturnType<typeof createBrandTheme>) {
  const { button, field, card, feedback, focus } = theme.components;
  const paint = (pair: ComponentColorTokens): ViewStyle => ({
    backgroundColor: pair.background,
    borderColor: pair.border,
  });
  const ink = (pair: ComponentColorTokens): TextStyle => ({ color: pair.foreground });
  const weight = (value: number) => String(value) as NonNullable<TextStyle['fontWeight']>;
  return {
    root: { flex: 1, backgroundColor: theme.colors.surface },
    header: { padding: theme.spacing.lg, backgroundColor: card.default.background },
    brand: {
      fontSize: theme.typography.titleSize,
      fontWeight: weight(theme.typography.strongWeight),
      color: card.default.foreground,
    },
    notice: {
      fontSize: theme.typography.smallSize,
      lineHeight: theme.typography.smallLineHeight,
      color: feedback.help.foreground,
      marginVertical: theme.spacing.sm,
    },
    copy: {
      fontSize: theme.typography.bodySize,
      lineHeight: theme.typography.bodyLineHeight,
      color: card.default.foreground,
      marginVertical: theme.spacing.sm,
    },
    page: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
    title: {
      fontSize: theme.typography.titleSize,
      lineHeight: theme.typography.titleLineHeight,
      fontWeight: weight(theme.typography.strongWeight),
      color: card.default.foreground,
      marginVertical: theme.spacing.md,
    },
    heading: {
      fontSize: theme.typography.bodySize,
      lineHeight: theme.typography.bodyLineHeight,
      fontWeight: weight(theme.typography.strongWeight),
      marginVertical: theme.spacing.md,
      color: card.default.foreground,
    },
    price: {
      fontSize: theme.typography.bodySize,
      lineHeight: theme.typography.bodyLineHeight,
      fontWeight: weight(theme.typography.strongWeight),
      color: card.default.foreground,
      marginVertical: theme.spacing.md,
    },
    card: {
      ...paint(card.default),
      borderWidth: 1,
      paddingHorizontal: card.paddingX,
      paddingVertical: card.paddingY,
      borderRadius: card.radius,
      marginVertical: theme.spacing.sm,
    },
    cardHovered: paint(card.hover),
    cardPressed: paint(card.pressed),
    cardSelected: paint(card.selected),
    cardDisabled: paint(card.disabled),
    button: {
      ...paint(button.default),
      borderWidth: 1,
      paddingHorizontal: button.paddingX,
      paddingVertical: button.paddingY,
      minHeight: button.minHeight,
      borderRadius: button.radius,
      marginVertical: theme.spacing.md,
      justifyContent: 'center' as const,
    },
    buttonHovered: paint(button.hover),
    buttonPressed: paint(button.pressed),
    buttonDisabled: paint(button.disabled),
    buttonText: {
      ...ink(button.default),
      fontSize: button.fontSize,
      lineHeight: button.lineHeight,
      fontWeight: weight(button.fontWeight),
    },
    buttonHoveredText: ink(button.hover),
    buttonPressedText: ink(button.pressed),
    buttonDisabledText: ink(button.disabled),
    focused: {
      outlineWidth: focus.width,
      outlineOffset: focus.offset,
      outlineStyle: 'solid' as const,
      outlineColor: focus.color,
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 0,
          blurRadius: 0,
          spreadDistance: focus.offset,
          color: focus.gapColor,
        },
      ],
    },
    input: {
      ...paint(field.default),
      borderWidth: 1,
      minHeight: field.minHeight,
      borderRadius: field.radius,
      paddingHorizontal: field.paddingX,
      paddingVertical: field.paddingY,
      fontSize: field.fontSize,
      lineHeight: field.lineHeight,
      fontWeight: weight(field.fontWeight),
      color: field.default.foreground,
    },
    inputFocused: {
      ...paint(field.focus),
      borderWidth: focus.width,
      color: field.focus.foreground,
    },
    inputDisabled: { ...paint(field.disabled), color: field.disabled.foreground },
    inputError: { borderColor: feedback.error.border },
    error: {
      backgroundColor: feedback.error.background,
      color: feedback.error.foreground,
      borderColor: feedback.error.border,
      borderWidth: 1,
      padding: theme.spacing.md,
      borderRadius: field.radius,
    },
  } satisfies Record<string, TextStyle | ViewStyle>;
}
