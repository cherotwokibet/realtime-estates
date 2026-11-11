import { useState } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { CatalogueButton } from './ReferenceCatalogueButton';
import type { MobileCustomerSession } from './customer-session';
import type { createReferenceCatalogueStyles } from './reference-theme';

type Ready = Extract<ReturnType<MobileCustomerSession['snapshot']>, { status: 'ready' }>;

export function SyntheticDeletionSettings({
  session,
  deletion,
  pushBusy,
  styles,
}: {
  session: MobileCustomerSession;
  deletion: NonNullable<Ready['deletion']>;
  pushBusy: boolean;
  styles: ReturnType<typeof createReferenceCatalogueStyles>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const revision = session.revision();
  const act = (action: () => unknown) => {
    if (session.revision() === revision) void action();
  };
  const { phase, receipt, alreadyPending } = deletion;
  return (
    <View>
      <CatalogueButton
        label={open ? 'Hide account deletion' : 'Account deletion'}
        onPress={() => {
          setOpen(!open);
          setConfirming(false);
          if (!open && phase === 'idle' && !pushBusy) act(session.checkDeletionRequest);
        }}
        styles={styles}
      />
      {open && (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.heading}>
            Account deletion request
          </Text>
          {receipt && (
            <Text accessibilityLiveRegion="polite" style={styles.copy}>
              {alreadyPending
                ? 'An earlier request is pending review.'
                : 'Your request is pending review.'}
            </Text>
          )}
          {(phase === 'checking' || phase === 'sending') && (
            <Text accessibilityLiveRegion="polite" style={styles.copy}>
              {phase === 'checking' ? 'Checking for a request…' : 'Sending your request…'}
            </Text>
          )}
          {(phase === 'idle' || phase === 'unavailable' || phase === 'uncertain') && (
            <>
              {phase === 'uncertain' && (
                <Text accessibilityLiveRegion="polite" style={styles.copy}>
                  We couldn’t confirm that your request was received.
                </Text>
              )}
              <CatalogueButton
                label="Check request status"
                disabled={pushBusy}
                onPress={() => act(session.checkDeletionRequest)}
                styles={styles}
              />
            </>
          )}
          {phase === 'missing' && (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.copy}>
                We found no pending request.
              </Text>
              <CatalogueButton
                label="Retry the same request"
                onPress={() => act(session.retryAccountDeletion)}
                styles={styles}
              />
            </>
          )}
          {phase === 'available' &&
            (confirming ? (
              <>
                <Text style={styles.copy}>
                  This preview sends a request for review and turns off transactional alerts for
                  this account.
                </Text>
                <CatalogueButton
                  label="Confirm deletion request"
                  disabled={pushBusy}
                  onPress={() =>
                    act(() => {
                      setConfirming(false);
                      return session.requestAccountDeletion({
                        policy: 'synthetic-customer-deletion-command-v1',
                        requestId: randomUUID(),
                        confirmed: true,
                      });
                    })
                  }
                  styles={styles}
                />
                <CatalogueButton
                  label="Cancel"
                  onPress={() => setConfirming(false)}
                  styles={styles}
                />
              </>
            ) : (
              <CatalogueButton
                label="Request account deletion"
                disabled={pushBusy}
                onPress={() => setConfirming(true)}
                styles={styles}
              />
            ))}
        </View>
      )}
    </View>
  );
}
