import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { randomUUID } from 'expo-crypto';
import { readNativeFirebaseConfig, type NativeFirebaseConfig } from './native-firebase-config';
import type { NativePasswordProvider } from './firebase-customer-sign-in';

/** One-use native password sign-in. No popup, AsyncStorage persistence, signup or mail/SMS APIs. */
export function firebaseNativePasswordProvider(
  input: NativeFirebaseConfig,
): NativePasswordProvider {
  const config = readNativeFirebaseConfig(input);
  if (!config) throw Error('Sign-in unavailable.');
  const app = initializeApp(config.firebase, 'realtor-native-' + randomUUID());
  let auth: ReturnType<typeof initializeAuth>;
  try {
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
  } catch {
    void deleteApp(app).catch(() => {});
    throw Error('Sign-in unavailable.');
  }
  let used = false,
    disposed = false;
  return {
    async password(email, password) {
      if (used || disposed) throw Error('Sign-in unavailable.');
      used = true;
      try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        if (disposed || !result.user.emailVerified) throw Error();
        const token = await result.user.getIdTokenResult();
        if (disposed) throw Error();
        return {
          idToken: token.token,
          expiresAt: token.expirationTime,
          emailVerified: result.user.emailVerified,
        };
      } catch {
        throw Error('Sign-in unavailable.');
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await signOut(auth);
      } finally {
        await deleteApp(app);
      }
    },
  };
}
