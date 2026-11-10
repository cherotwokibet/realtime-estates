import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import type { createReferenceCatalogueStyles } from './reference-theme';

type CatalogueStyles = ReturnType<typeof createReferenceCatalogueStyles>;
export function CatalogueButton({
  label,
  onPress,
  styles: s,
  accessibilityLabel,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  styles: CatalogueStyles;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false),
    [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        s.button,
        hovered && s.buttonHovered,
        pressed && s.buttonPressed,
        focused && !disabled && s.focused,
        disabled && s.buttonDisabled,
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            s.buttonText,
            hovered && s.buttonHoveredText,
            pressed && s.buttonPressedText,
            disabled && s.buttonDisabledText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
