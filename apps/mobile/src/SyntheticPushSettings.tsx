import { useState } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { MobileCustomerSession } from './customer-session';
import type { createReferenceCatalogueStyles } from './reference-theme';
import { CatalogueButton } from './ReferenceCatalogueButton';

type Snapshot = ReturnType<MobileCustomerSession['snapshot']>;
type PushSnapshot = NonNullable<Extract<Snapshot, { status: 'ready' }>['push']>;

export function SyntheticPushSettings({
  session,
  push,
  styles: s,
}: {
  session: MobileCustomerSession;
  push: PushSnapshot;
  styles: ReturnType<typeof createReferenceCatalogueStyles>;
}) {
  const [open, setOpen] = useState(false);
  const [registrationId] = useState(randomUUID);
  const revision = session.revision();
  const preferences = push.preferences;
  const act = (action: () => unknown) => {
    if (session.revision() === revision) void action();
  };
  function change(action: 'consent' | 'register' | 'revoke') {
    if (!preferences) return;
    const base = {
      policy: 'synthetic-customer-push-command-v1' as const,
      operationId: randomUUID(),
      expectedVersion: preferences.version,
    };
    act(() =>
      session.changePushPreferences(
        action === 'consent'
          ? { ...base, action, enabled: !preferences.enabled, registrationId: null }
          : { ...base, action, enabled: null, registrationId },
      ),
    );
  }
  return (
    <View>
      <CatalogueButton
        label={open ? 'Hide notification preferences' : 'Notification preferences'}
        onPress={() => {
          setOpen(!open);
          if (!open && (push.phase === 'idle' || push.phase === 'unavailable'))
            act(session.loadPushPreferences);
        }}
        styles={s}
      />
      {open && (
        <View style={s.card}>
          <Text accessibilityRole="header" style={s.heading}>
            Transactional alerts
          </Text>
          <Text style={s.copy}>
            This preview saves your preference and uses a test device registration.
          </Text>
          {(push.phase === 'loading' || push.phase === 'busy') && (
            <Text accessibilityLiveRegion="polite" style={s.copy}>
              Checking notification preferences…
            </Text>
          )}
          {push.phase === 'unavailable' && (
            <CatalogueButton
              label="Reload preferences"
              onPress={() => act(session.loadPushPreferences)}
              styles={s}
            />
          )}
          {push.phase === 'uncertain' && (
            <>
              <Text accessibilityLiveRegion="polite" style={s.copy}>
                We couldn’t confirm your change.
              </Text>
              <CatalogueButton
                label="Check original change"
                onPress={() => act(session.recoverPushPreferences)}
                styles={s}
              />
            </>
          )}
          {push.phase === 'missing' && (
            <CatalogueButton
              label="Retry original change"
              onPress={() => act(session.retryPushPreferences)}
              styles={s}
            />
          )}
          {push.conflict && (
            <Text accessibilityLiveRegion="polite" style={s.copy}>
              Preferences changed. Review the current setting and try again.
            </Text>
          )}
          {preferences && (
            <>
              <Text accessibilityLiveRegion="polite" style={s.copy}>
                Alerts {preferences.enabled ? 'enabled' : 'disabled'}. Active test registrations:{' '}
                {preferences.activeDevices}.
              </Text>
              <CatalogueButton
                label={preferences.enabled ? 'Turn off alerts' : 'Allow transactional alerts'}
                onPress={() => change('consent')}
                styles={s}
              />
              {preferences.enabled && (
                <>
                  <CatalogueButton
                    label="Register test device"
                    onPress={() => change('register')}
                    styles={s}
                  />
                  <CatalogueButton
                    label="Remove this test registration"
                    onPress={() => change('revoke')}
                    styles={s}
                  />
                </>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}
