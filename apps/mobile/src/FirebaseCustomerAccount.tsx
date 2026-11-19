import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createFirebaseMobileSignIn } from './firebase-customer-sign-in';
import { firebaseNativePasswordProvider } from './firebase-native-provider';
import type { NativeFirebaseConfig } from './native-firebase-config';

export function FirebaseCustomerAccount({ config }: { config: NativeFirebaseConfig }) {
  const [client] = useState(() =>
    createFirebaseMobileSignIn(config, {
      provider: () => firebaseNativePasswordProvider(config),
      uuid: randomUUID,
    }),
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  useSyncExternalStore(client.subscribe, client.revision, client.revision);
  const { phase } = client.snapshot();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setPassword('');
        client.signOut();
      }
    });
    return () => {
      subscription.remove();
      client.signOut();
    };
  }, [client]);
  const submit = () => {
    const supplied = password;
    setPassword('');
    void client.signIn(email, supplied);
  };
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          Your account
        </Text>
        {phase === 'ready' ? (
          <>
            <Text accessibilityLiveRegion="polite">
              You are signed in. For your privacy, this session ends after five minutes or when you
              leave the app.
            </Text>
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
                Sign-in could not be completed. Check your account details and connection, then try
                again.
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
      </View>
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
