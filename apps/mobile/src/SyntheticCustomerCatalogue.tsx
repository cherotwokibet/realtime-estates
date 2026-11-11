import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { getDemoTheme } from '@realtor/demo';
import { CatalogueButton } from './ReferenceCatalogueButton';
import { createMobileCustomerSession } from './customer-session';
import { SyntheticPushSettings } from './SyntheticPushSettings';
import { ReferenceCatalogueApp } from './ReferenceCatalogueApp';
import type { MobileReferenceConfig } from './reference-catalogue';
import { createReferenceCatalogueStyles } from './reference-theme';
import {
  requestSyntheticCustomerGrant,
  syntheticCustomerCompanyId,
} from './synthetic-customer-sign-in';

const transport = expoFetch as unknown as typeof fetch;
export function SyntheticCustomerCatalogue({
  config,
}: {
  config: Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>;
}) {
  const tenantId = syntheticCustomerCompanyId(config.tenantSlug);
  const session = useMemo(
    () =>
      createMobileCustomerSession(
        {
          mode: 'runtime-customer-v1',
          tenantId,
          apiOrigin: config.apiOrigin,
          allowLoopbackHttp: true,
          pushMode: config.pushMode,
        },
        transport,
      ),
    [tenantId, config.apiOrigin, config.pushMode],
  );
  const styles = useMemo(
    () => StyleSheet.create(createReferenceCatalogueStyles(getDemoTheme(config.tenantSlug))),
    [config.tenantSlug],
  );
  useSyncExternalStore(session.subscribe, session.revision);
  const snapshot = session.snapshot();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
      session.clear();
    },
    [session],
  );

  async function signIn(persona: 'a' | 'b') {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    session.clear();
    setFailed(false);
    setBusy(true);
    const grant = await requestSyntheticCustomerGrant(
      config.apiOrigin,
      tenantId,
      persona,
      controller.signal,
      transport,
    );
    if (active.current !== controller) return;
    const ready = grant ? await session.activate(grant) : false;
    if (active.current !== controller) return;
    active.current = null;
    setBusy(false);
    setFailed(!ready);
  }
  const account =
    snapshot.status === 'ready' ? (snapshot.account.customerId.endsWith('13') ? 'A' : 'B') : null;
  return (
    <ReferenceCatalogueApp
      config={config}
      customerSession={session}
      customerSignIn={
        <View>
          <Text accessibilityLiveRegion="polite" style={styles.copy}>
            {busy
              ? 'Signing in to the preview…'
              : account
                ? `Signed in as preview customer ${account}.`
                : 'Choose a preview customer.'}
          </Text>
          {failed && (
            <Text accessibilityRole="alert" style={styles.error}>
              Preview sign-in is unavailable. Check that the local preview is running.
            </Text>
          )}
          {snapshot.status === 'ready' && snapshot.push && (
            <SyntheticPushSettings
              key={snapshot.activation}
              session={session}
              push={snapshot.push}
              styles={styles}
            />
          )}
          <CatalogueButton
            label="Sign in as preview customer A"
            onPress={() => void signIn('a')}
            disabled={busy || account === 'A'}
            styles={styles}
          />
          <CatalogueButton
            label="Sign in as preview customer B"
            onPress={() => void signIn('b')}
            disabled={busy || account === 'B'}
            styles={styles}
          />
          {(busy || account) && (
            <CatalogueButton
              label={busy ? 'Cancel sign-in' : 'Sign out'}
              onPress={() => {
                active.current?.abort();
                active.current = null;
                session.clear();
                setBusy(false);
                setFailed(false);
              }}
              styles={styles}
            />
          )}
        </View>
      }
    />
  );
}
