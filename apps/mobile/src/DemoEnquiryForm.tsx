import { KeyboardForm } from './KeyboardForm';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DemoDraftError,
  type DemoEnquiryHandle,
  type DemoEnquiryKind,
} from './demo-enquiry-drafts';
export function DemoEnquiryForm({
  handle,
  primary,
  onBack,
  onSaved,
  onReview,
}: {
  handle: DemoEnquiryHandle;
  primary: string;
  onBack(): void;
  onSaved(): void;
  onReview(): void;
}) {
  const [kind, setKind] = useState<DemoEnquiryKind>('availability');
  const [message, setMessage] = useState('Is this property available?');
  const [day, setDay] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  return (
    <KeyboardForm>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.button}>
          <Text style={{ color: primary }}>← Back to property</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>
          Prepare demo enquiry
        </Text>
        <Text style={styles.property}>{handle.listingTitle}</Text>
        <Text style={styles.copy}>
          Use fictional details. This draft stays in this preview and clears when the app
          backgrounds. Nothing is sent and no viewing is booked.
        </Text>
        {saved ? (
          <View accessibilityLiveRegion="polite">
            <Text accessibilityRole="header" style={styles.title}>
              Draft saved locally
            </Text>
            <Text style={styles.copy}>
              Review or remove it from Profile. This is not an enquiry receipt or a confirmed
              booking.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onReview}
              style={[styles.button, { backgroundColor: primary }]}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Review draft in Profile</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Demo enquiry type"
              style={styles.choices}
            >
              {(['availability', 'viewing'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: kind === value }}
                  onPress={() => {
                    setKind(value);
                    setMessage((current) =>
                      [
                        'Is this property available?',
                        'I would like to ask about viewing this property.',
                      ].includes(current)
                        ? value === 'viewing'
                          ? 'I would like to ask about viewing this property.'
                          : 'Is this property available?'
                        : current,
                    );
                    setDay('');
                    setError('');
                  }}
                  style={[styles.button, kind === value && { borderColor: primary }]}
                >
                  <Text>
                    {value === 'availability' ? 'Check availability' : 'Viewing preference'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {kind === 'viewing' && (
              <>
                <Text style={styles.label}>Preferred viewing day (Nairobi)</Text>
                <TextInput
                  accessibilityLabel="Preferred viewing day in YYYY-MM-DD format, Nairobi"
                  value={day}
                  onChangeText={setDay}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#667085"
                  maxLength={10}
                  autoCorrect={false}
                  style={styles.input}
                />
                <Text style={styles.copy}>
                  A preference only; no availability or appointment is confirmed.
                </Text>
              </>
            )}
            <Text style={styles.label}>Message</Text>
            <TextInput
              accessibilityLabel="Demo enquiry message"
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={1000}
              textAlignVertical="top"
              style={[styles.input, { minHeight: 130 }]}
            />
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                try {
                  handle.save({ kind, message, preferredDay: day });
                  setSaved(true);
                  setError('');
                  onSaved();
                } catch (e) {
                  setError(
                    e instanceof DemoDraftError ? e.message : 'The demo draft could not be saved.',
                  );
                }
              }}
              style={[styles.button, { backgroundColor: primary }]}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Save local draft</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardForm>
  );
}
const styles = StyleSheet.create({
  page: { padding: 22, paddingBottom: 40, gap: 14 },
  title: { fontSize: 24, fontWeight: '700', color: '#20242b' },
  property: { fontSize: 17, fontWeight: '600', color: '#20242b' },
  copy: { fontSize: 15, lineHeight: 23, color: '#596371' },
  choices: { gap: 8 },
  button: { minHeight: 48, padding: 14, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#20242b' },
  input: {
    borderWidth: 1,
    borderColor: '#98a2b3',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#20242b',
  },
  error: { color: '#9d2020', fontSize: 15 },
});
