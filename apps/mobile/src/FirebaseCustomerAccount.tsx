import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createFirebaseMobileSignIn } from './firebase-customer-sign-in';
import { firebaseNativePasswordProvider } from './firebase-native-provider';
import type { NativeFirebaseConfig } from './native-firebase-config';
import { createNativeSavedProperties } from './native-saved-properties';
import { NativeSavedProperties } from './NativeSavedProperties';

export function FirebaseCustomerAccount({ config }: { config: NativeFirebaseConfig }) {
  const [client] = useState(() =>
    createFirebaseMobileSignIn(config, {
      provider: () => firebaseNativePasswordProvider(config),
      uuid: randomUUID,
    }),
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [saved] = useState(() =>
    createNativeSavedProperties(client.session, config.propertyLinkOrigin, 12000, randomUUID),
  );
  const [savedActivation, setSavedActivation] = useState<number | null>(null);
  useSyncExternalStore(client.subscribe, client.revision, client.revision);
  const { phase } = client.snapshot();
  const currentSession = client.session.snapshot();
  const showingSaved =
    phase === 'ready' &&
    currentSession.status === 'ready' &&
    savedActivation === currentSession.activation;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setPassword('');
        client.signOut();
        saved.hide();
      }
    });
    return () => {
      subscription.remove();
      client.signOut();
      saved.hide();
    };
  }, [client, saved]);
  const submit = () => {
    const supplied = password;
    setPassword('');
    void client.signIn(email, supplied);
  };
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.heading}>
            Your account
          </Text>
          {showingSaved ? (
            <NativeSavedProperties
              controller={saved}
              close={() => {
                saved.hide();
                setSavedActivation(null);
              }}
            />
          ) : phase === 'ready' ? (
            <>
              <Text accessibilityLiveRegion="polite">
                You are signed in. For your privacy, this session ends after five minutes or when
                you leave the app.
              </Text>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => {
                  const account = client.session.snapshot();
                  if (account.status !== 'ready') return;
                  setSavedActivation(account.activation);
                  void saved.first();
                }}
              >
                <Text style={styles.buttonText}>Saved properties</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => {
                  client.signOut();
                  setPassword('');
                }}
              >
                <Text style={styles.buttonText}>Sign out</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text>Sign in with your verified email account.</Text>
              <Text accessibilityLabel="Email">Email</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                maxLength={320}
                value={email}
                onChangeText={setEmail}
                editable={phase !== 'signing_in'}
                style={styles.input}
              />
              <Text>Password</Text>
              <TextInput
                accessibilityLabel="Password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="current-password"
                maxLength={4096}
                value={password}
                onChangeText={setPassword}
                editable={phase !== 'signing_in'}
                style={styles.input}
              />
              {phase === 'unavailable' && (
                <Text accessibilityRole="alert">
                  Sign-in could not be completed. Check your account details and connection, then
                  try again.
                </Text>
              )}
              {phase === 'signing_in' ? (
                <>
                  <Text accessibilityLiveRegion="polite">Signing in…</Text>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.button}
                    onPress={client.signOut}
                  >
                    <Text style={styles.buttonText}>Cancel</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !email || !password }}
                  disabled={!email || !password}
                  style={styles.button}
                  onPress={submit}
                >
                  <Text style={styles.buttonText}>Sign in</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  content: { padding: 24, gap: 16 },
  heading: { fontSize: 26, fontWeight: '700', color: '#101828' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#667085',
    borderRadius: 8,
    padding: 12,
    color: '#101828',
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#185C47',
  },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
