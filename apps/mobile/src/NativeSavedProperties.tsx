import React, { useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeSavedPropertiesController } from './native-saved-properties';

export function NativeSavedProperties({
  controller,
  close,
}: {
  controller: NativeSavedPropertiesController;
  close: () => void;
}) {
  const revision = useSyncExternalStore(
    controller.subscribe,
    controller.revision,
    controller.revision,
  );
  const state = controller.snapshot();
  const [openError, setOpenError] = useState<number | null>(null);
  const button = (label: string, act: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={act}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  const open = (id: string) => {
    if (controller.revision() !== revision) return;
    const url = controller.propertyUrl(id);
    if (!url) return;
    setOpenError(null);
    void Linking.openURL(url).catch(() => {
      if (controller.revision() === revision) setOpenError(revision);
    });
  };
  return (
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>
        Saved properties
      </Text>
      {button('Back to account', close)}
      {state.phase === 'loading' && (
        <Text accessibilityLiveRegion="polite">Loading saved properties…</Text>
      )}
      {state.phase === 'unavailable' && (
        <Text accessibilityRole="alert">Your saved properties could not be loaded. Try again.</Text>
      )}
      {(state.phase === 'idle' || state.phase === 'unavailable') &&
        button('Reload saved properties', () => {
          void controller.reload();
        })}
      {state.phase === 'ready' && (
        <>
          <Text accessibilityLiveRegion="polite">Page {state.pageNumber}</Text>
          {state.page?.items.length === 0 && (
            <Text>
              {state.pageNumber === 1
                ? 'You have no saved properties.'
                : 'No saved properties on this page.'}
            </Text>
          )}
          {state.page?.items.map((item, index) => (
            <View key={item.listingId} style={styles.card}>
              <Text accessibilityRole="header">
                Saved property {(state.pageNumber - 1) * 20 + index + 1}
              </Text>
              {!item.available && <Text>This property is no longer available.</Text>}
              {item.available && !controller.propertyUrl(item.listingId) && (
                <Text>Property details are unavailable right now.</Text>
              )}
              {item.available &&
                controller.propertyUrl(item.listingId) &&
                button('View property ' + ((state.pageNumber - 1) * 20 + index + 1), () =>
                  open(item.listingId),
                )}
            </View>
          ))}
          {state.pageNumber > 1 &&
            button('First saved properties page', () => {
              void controller.first();
            })}
          {state.page?.hasMore &&
            button('Next saved properties page', () => {
              void controller.next();
            })}
          {button('Refresh saved properties', () => {
            void controller.reload();
          })}
        </>
      )}
      {openError === revision && (
        <Text accessibilityRole="alert">The property could not be opened. Try again.</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: '#101828' },
  card: { gap: 12, padding: 16, borderWidth: 1, borderColor: '#667085', borderRadius: 8 },
  button: {
    minHeight: 48,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#185C47',
    borderRadius: 8,
  },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
