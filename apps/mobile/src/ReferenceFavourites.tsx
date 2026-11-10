import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { CatalogueButton } from './ReferenceCatalogueButton';
import type { MobileCustomerSession } from './customer-session';
import type { MobileReferenceItem } from './reference-catalogue';
import type { createReferenceCatalogueStyles } from './reference-theme';

type Styles = ReturnType<typeof createReferenceCatalogueStyles>;
type Props = { session: MobileCustomerSession; styles: Styles };

function useCustomer(session: MobileCustomerSession) {
  const revision = useSyncExternalStore(session.subscribe, session.revision);
  return { revision, snapshot: session.snapshot() };
}

function useFavouriteRead<T>(session: MobileCustomerSession, read: () => Promise<T | null>) {
  const { revision, snapshot } = useCustomer(session);
  const ready = snapshot.status === 'ready' && snapshot.phase === 'idle';
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{
    session: MobileCustomerSession;
    revision: number;
    read: typeof read;
    attempt: number;
    value: T | null;
  }>();
  useEffect(() => {
    setResult(undefined);
    if (!ready || session.revision() !== revision) return;
    let current = true;
    void read().then((value) => {
      if (current && session.revision() === revision)
        setResult({ session, revision, read, attempt, value });
    });
    return () => {
      current = false;
    };
  }, [session, revision, ready, read, attempt]);

  const value =
    result?.session === session &&
    result.revision === revision &&
    result.read === read &&
    result.attempt === attempt
      ? result.value
      : undefined;
  return { revision, ready, value, retry: () => retry((number) => number + 1) };
}

function changeFavourite(
  session: MobileCustomerSession,
  revision: number,
  listingId: string,
  version: string,
  saved: boolean,
) {
  if (session.revision() !== revision) return;
  return session.save({
    policy: 'customer-favourite-command-v1',
    operationId: randomUUID(),
    listingId,
    expectedVersion: version,
    saved,
  });
}

export function FavouriteOperation({ session, styles: s }: Props) {
  const { snapshot, revision } = useCustomer(session);
  const act = (action: () => unknown) => {
    if (session.revision() === revision) void action();
  };
  if (snapshot.status !== 'ready' || snapshot.phase === 'idle') return null;
  if (snapshot.phase === 'busy')
    return (
      <Text accessibilityLiveRegion="polite" style={s.copy}>
        Checking your saved property…
      </Text>
    );
  return (
    <View>
      {snapshot.phase === 'uncertain' && (
        <>
          <Text accessibilityLiveRegion="polite" style={s.copy}>
            We couldn’t confirm the change. Check its status before trying again.
          </Text>
          <CatalogueButton
            label="Check change status"
            onPress={() => act(session.recover)}
            styles={s}
          />
        </>
      )}
      {snapshot.phase === 'missing' && (
        <>
          <Text accessibilityLiveRegion="polite" style={s.copy}>
            The change hasn’t been recorded. You can retry it.
          </Text>
          <CatalogueButton
            label="Retry saved property change"
            onPress={() => act(session.retry)}
            styles={s}
          />
        </>
      )}
      {snapshot.phase === 'settled' && (
        <>
          <Text accessibilityLiveRegion="polite" style={s.copy}>
            {snapshot.receipt?.outcome === 'conflict'
              ? 'The saved status changed. Continue to refresh it.'
              : snapshot.receipt?.saved
                ? 'Property saved.'
                : 'Property removed from saved properties.'}
          </Text>
          <CatalogueButton label="Continue" onPress={() => act(session.settle)} styles={s} />
        </>
      )}
    </View>
  );
}

export function FavouriteDetail({ session, listingId, styles: s }: Props & { listingId: string }) {
  const read = useCallback(() => session.favourite(listingId), [session, listingId]);
  const state = useFavouriteRead(session, read);
  if (!state.ready) return null;
  if (!state.value)
    return (
      <View>
        <Text accessibilityLiveRegion="polite" style={s.copy}>
          {state.value === null ? 'Saved status is unavailable.' : 'Loading saved status…'}
        </Text>
        {state.value === null && (
          <CatalogueButton label="Reload saved status" onPress={state.retry} styles={s} />
        )}
      </View>
    );
  const { version, saved } = state.value;
  return (
    <CatalogueButton
      label={saved ? 'Remove from saved properties' : 'Save property'}
      onPress={() => void changeFavourite(session, state.revision, listingId, version, !saved)}
      styles={s}
    />
  );
}

export function SavedProperties({
  session,
  knownProperties,
  openProperty,
  styles: s,
}: Props & {
  knownProperties: readonly MobileReferenceItem[];
  openProperty: (item: MobileReferenceItem) => void;
}) {
  const { snapshot } = useCustomer(session);
  const activation = snapshot.status === 'ready' ? snapshot.activation : null;
  const [cursor, setCursor] = useState<{
    session: MobileCustomerSession;
    activation: number;
    after: string;
  }>();
  const after =
    cursor?.session === session && cursor.activation === activation ? cursor.after : undefined;
  const read = useCallback(() => session.list(after ? { after } : {}), [session, after]);
  const state = useFavouriteRead(session, read);
  const page = state.value;
  return (
    <View>
      <Text accessibilityRole="header" style={s.title}>
        Saved properties
      </Text>
      {snapshot.status !== 'ready' && (
        <Text accessibilityLiveRegion="polite" style={s.copy}>
          {snapshot.status === 'activating'
            ? 'Checking your account…'
            : 'Sign in to see your saved properties.'}
        </Text>
      )}
      {state.ready && (
        <>
          {page === undefined && (
            <Text accessibilityLiveRegion="polite" style={s.copy}>
              Loading saved properties…
            </Text>
          )}
          {page === null && (
            <CatalogueButton label="Reload saved properties" onPress={state.retry} styles={s} />
          )}
          {page?.items.length === 0 && (
            <Text style={s.copy}>
              {after ? 'No saved properties on this page.' : 'You have no saved properties.'}
            </Text>
          )}
          {page?.items.map((item, index) => {
            const property =
              item.available &&
              knownProperties.find((entry) => entry.property.id === item.listingId);
            const title = property ? property.property.title : `Saved property ${index + 1}`;
            return (
              <View key={item.listingId} style={s.card}>
                <Text accessibilityRole="header" style={s.heading}>
                  {title}
                </Text>
                {property ? (
                  <CatalogueButton
                    label={`View ${title}`}
                    onPress={() => openProperty(property)}
                    styles={s}
                  />
                ) : (
                  <Text style={s.copy}>
                    {item.available
                      ? 'Details are outside the current search results.'
                      : 'This listing is unavailable.'}
                  </Text>
                )}
                <CatalogueButton
                  label={`Remove ${title}`}
                  onPress={() =>
                    void changeFavourite(
                      session,
                      state.revision,
                      item.listingId,
                      item.version,
                      false,
                    )
                  }
                  styles={s}
                />
              </View>
            );
          })}
          {after && (
            <CatalogueButton
              label="First saved properties page"
              onPress={() => setCursor(undefined)}
              styles={s}
            />
          )}
          {page?.hasMore && activation !== null && (
            <CatalogueButton
              label="Next saved properties page"
              onPress={() =>
                setCursor({
                  session,
                  activation,
                  after: page.items[page.items.length - 1]!.listingId,
                })
              }
              styles={s}
            />
          )}
        </>
      )}
    </View>
  );
}
