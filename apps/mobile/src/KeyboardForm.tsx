import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView } from 'react-native';

/** Keep forms above the software keyboard, including Android edge-to-edge windows. */
export function KeyboardForm({ children }: PropsWithChildren) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}
