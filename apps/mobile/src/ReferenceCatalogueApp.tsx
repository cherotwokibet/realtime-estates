import React, { useEffect, useMemo, useRef, useState } from 'react';
import PublishedListingVideo from './PublishedListingVideo';
import PublishedFloorPlan from './PublishedFloorPlan';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PublicSearchInput } from '@realtor/api-client';
import { getDemoBrand, getDemoTheme } from '@realtor/demo';
import { formatKes } from '@realtor/domain';
import { type MobileReferenceConfig, type MobileReferenceItem } from './reference-catalogue';
import {
  createMobileReferenceReadSession,
  type MobileReferenceReadResult,
} from './reference-read-session';
import { createReferenceCatalogueStyles } from './reference-theme';
import { ReferenceSearchForm } from './ReferenceSearchForm';
import {
  createMobileReferenceSearchStore,
  emptyMobileReferenceFilters,
  prepareMobileReferenceSearch,
  mobileReferenceSearchSummary,
  type MobileReferenceFilters,
} from './reference-search';

type CatalogueStyles = ReturnType<typeof createReferenceCatalogueStyles>;
function CatalogueButton({
  label,
  onPress,
  styles: s,
  accessibilityLabel,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  styles: CatalogueStyles;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false),
    [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        s.button,
        hovered && s.buttonHovered,
        pressed && s.buttonPressed,
        focused && !disabled && s.focused,
        disabled && s.buttonDisabled,
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            s.buttonText,
            hovered && s.buttonHoveredText,
            pressed && s.buttonPressedText,
            disabled && s.buttonDisabledText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
function CatalogueCard({
  children,
  onPress,
  label,
  styles: s,
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  styles: CatalogueStyles;
}) {
  const [focused, setFocused] = useState(false),
    [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        s.card,
        hovered && s.cardHovered,
        pressed && s.cardPressed,
        focused && s.focused,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function ReferenceCatalogueApp({
  config,
}: {
  config: Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>;
}) {
  return (
    <ReferenceCatalogueSession key={`${config.tenantSlug}:${config.apiOrigin}`} config={config} />
  );
}
function ReferenceCatalogueSession({
  config,
}: {
  config: Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>;
}) {
  const brand = getDemoBrand(config.tenantSlug);
  const theme = useMemo(() => getDemoTheme(config.tenantSlug), [config.tenantSlug]);
  const s = useMemo(() => StyleSheet.create(createReferenceCatalogueStyles(theme)), [theme]);
  const [result, setResult] = useState<MobileReferenceReadResult | null>(null);
  const [readSession] = useState(() => createMobileReferenceReadSession(config));
  const activeRead = useRef<AbortController | null>(null);
  const [request, setRequest] = useState(0);
  const [filters, setFilters] = useState<MobileReferenceFilters>({
    ...emptyMobileReferenceFilters,
  });
  const [filterError, setFilterError] = useState('');
  const [search, setSearch] = useState<PublicSearchInput>({ offset: 0 });
  const [selected, setSelected] = useState<MobileReferenceItem | null>(null);
  const [restored, setRestored] = useState(false);
  const [storageNotice, setStorageNotice] = useState('');
  const mounted = useRef(true);
  const [searchStore] = useState(() => createMobileReferenceSearchStore(AsyncStorage, config));
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void searchStore.load().then((saved) => {
      if (!active) return;
      if (saved.status === 'ready') {
        const prepared = prepareMobileReferenceSearch(saved.filters);
        if (prepared.status === 'ready') {
          setFilters(saved.filters);
          setSearch(prepared.input);
          setStorageNotice('Saved search filters restored from this device.');
        }
      } else if (saved.status === 'discarded') {
        setStorageNotice('Incompatible saved filters were cleared. Start a new search.');
      } else if (saved.status === 'unavailable') {
        setStorageNotice('Saved filters could not be read. You can search for this session.');
      }
      setRestored(true);
    });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [searchStore]);
  useEffect(() => {
    if (!restored) return;
    const controller = new AbortController();
    activeRead.current = controller;
    let active = true;
    setResult(null);
    setSelected(null);
    void readSession.read({ ...search, limit: 24 }, controller.signal).then((value) => {
      if (active && !controller.signal.aborted) setResult(value);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [readSession, request, search, restored]);
  useEffect(() => () => readSession.clear(), [readSession]);
  const shown = result?.status === 'ready' ? result.items : [];
  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.brand}>
          {brand.name}
        </Text>
        <Text style={s.notice}>Synthetic API preview · no real availability</Text>
        <Text style={s.copy}>Enquiries, contact and viewing requests are disabled.</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
        {storageNotice !== '' && (
          <Text accessibilityLiveRegion="polite" style={s.notice}>
            {storageNotice}
          </Text>
        )}
        {!selected && restored && (
          <View>
            <ReferenceSearchForm filters={filters} onChange={setFilters} styles={s} />
            {filterError !== '' && (
              <Text accessibilityRole="alert" style={s.error}>
                {filterError}
              </Text>
            )}
            <CatalogueButton
              label="Search all approved properties"
              onPress={() => {
                const prepared = prepareMobileReferenceSearch(filters);
                if (prepared.status === 'invalid') {
                  setFilterError(prepared.message);
                  return;
                }
                setFilterError('');
                activeRead.current?.abort();
                setResult(null);
                setSearch(prepared.input);
                void searchStore.save(filters).then((saved) => {
                  if (mounted.current)
                    setStorageNotice(
                      saved
                        ? 'Search filters saved on this device.'
                        : 'Search applied for this session. Filters could not be saved on this device.',
                    );
                });
              }}
              styles={s}
            />
            <CatalogueButton
              label="Clear all search filters"
              onPress={() => {
                setFilters({ ...emptyMobileReferenceFilters });
                setFilterError('');
                activeRead.current?.abort();
                readSession.clear();
                setResult(null);
                setSearch({ offset: 0 });
                void searchStore.clear().then((cleared) => {
                  if (mounted.current)
                    setStorageNotice(
                      cleared
                        ? 'Saved search filters cleared from this device.'
                        : 'Search cleared for this session. Saved filters could not be removed; try Clear again.',
                    );
                });
              }}
              styles={s}
            />
            <Text style={s.notice}>
              Search covers matching public properties. Results may change between pages; traversal
              is limited to offset 10,000.
            </Text>
          </View>
        )}
        {result === null && (
          <Text accessibilityLiveRegion="polite" style={s.copy}>
            {restored ? 'Loading approved property details…' : 'Restoring saved search filters…'}
          </Text>
        )}
        {result === null && restored && (
          <CatalogueButton
            label="Cancel loading"
            onPress={() => {
              activeRead.current?.abort();
              setResult({ status: 'error' });
            }}
            styles={s}
          />
        )}
        {result?.status === 'ready' && result.freshness === 'previous' && (
          <View>
            <Text accessibilityRole="alert" style={s.error}>
              Could not refresh. Showing the previous public response loaded at{' '}
              {new Date(result.loadedAt).toISOString()}. Counts, prices and availability have not
              been rechecked. This response is kept only in this app session. Reconnect and retry
              before changing result pages.
            </Text>
            <CatalogueButton
              label="Retry current search"
              onPress={() => setRequest((value) => value + 1)}
              styles={s}
            />
            <CatalogueButton
              label="Clear previous response"
              onPress={() => {
                activeRead.current?.abort();
                readSession.clear();
                setSelected(null);
                setResult({ status: 'error' });
              }}
              styles={s}
            />
          </View>
        )}
        {result?.status === 'error' && (
          <View>
            <Text accessibilityRole="alert" style={[s.copy, s.error]}>
              The property catalogue could not be loaded.
            </Text>
            <CatalogueButton
              label="Try again"
              onPress={() => setRequest((value) => value + 1)}
              styles={s}
            />
          </View>
        )}
        {result?.status === 'ready' &&
          (selected ? (
            <View style={[s.card, s.cardSelected]}>
              <CatalogueButton
                label="← Back to results"
                accessibilityLabel="Back to property results"
                onPress={() => setSelected(null)}
                styles={s}
              />
              <Text accessibilityRole="header" style={s.title}>
                {selected.property.title}
              </Text>
              <Text style={s.copy}>{selected.location}</Text>
              <Text style={s.price}>
                {selected.base}
                {selected.property.rentPeriod ? ` / ${selected.property.rentPeriod}` : ''}
              </Text>
              <Text style={s.notice}>
                Property photos unavailable in this metadata-only preview.
              </Text>
              <Text style={s.copy}>{selected.property.description}</Text>
              {config.floorPlanMode && (
                <PublishedFloorPlan
                  key={`floor:${config.tenantSlug}:${config.apiOrigin}:${selected.property.id}:${selected.property.revision}:${selected.property.reference.revisionVersion}`}
                  config={config}
                  property={selected.property}
                />
              )}
              {config.videoMode && (
                <PublishedListingVideo
                  key={`${config.tenantSlug}:${config.apiOrigin}:${selected.property.id}:${selected.property.revision}:${selected.property.reference.revisionVersion}`}
                  config={config}
                  property={selected.property}
                />
              )}
              <Text style={s.copy}>
                {selected.property.propertyType} ·{' '}
                {selected.property.bedrooms === null
                  ? 'Bedrooms not applicable'
                  : selected.property.bedrooms === 0
                    ? 'Open-plan room'
                    : `${selected.property.bedrooms} bedrooms`}
              </Text>
              <Text style={s.copy}>
                Private bathrooms: {selected.property.privateBathrooms ?? 'Not supplied'} · Shared
                bathrooms: {selected.property.sharedBathrooms ?? 'Not supplied'}
              </Text>
              <Text accessibilityRole="header" style={s.heading}>
                Features & amenities
              </Text>
              {selected.amenities === null ? (
                <Text style={s.copy}>Not supplied</Text>
              ) : selected.amenities.length === 0 ? (
                <Text style={s.copy}>No amenities selected in the approved listing.</Text>
              ) : (
                selected.amenities.map((amenity) => (
                  <Text key={amenity.id} style={s.copy}>
                    {amenity.label}
                  </Text>
                ))
              )}
              <Text accessibilityRole="header" style={s.heading}>
                Price & costs
              </Text>
              {selected.property.pricing.charges.map((charge) => (
                <Text key={charge.id} style={s.copy}>
                  {charge.name}:{' '}
                  {charge.amountStatus === 'known' ? formatKes(charge.amount) : 'Quote required'} ·{' '}
                  {charge.mandatory ? 'Mandatory' : 'Optional'} ·{' '}
                  {charge.classification === 'refundable_deposit' ? 'Refundable deposit' : 'Fee'} ·{' '}
                  {charge.timing === 'one_off' ? 'One-off' : `Per ${selected.property.rentPeriod}`}
                </Text>
              ))}
              {selected.property.pricing.charges.length === 0 && (
                <Text style={s.copy}>No named charges supplied.</Text>
              )}
              {selected.recurring !== null && (
                <Text style={s.copy}>
                  Known recurring subtotal: {selected.recurring} / {selected.property.rentPeriod}
                </Text>
              )}
              <Text style={s.copy}>Known initial subtotal: {selected.initial}</Text>
              <Text style={s.notice}>
                {selected.property.pricing.mandatoryAmountsComplete
                  ? 'Declared mandatory amounts supplied.'
                  : 'Mandatory costs remain unresolved; the known subtotal is not an all-in quote.'}{' '}
                Confirm actual costs independently. Initial subtotal includes one base/first period
                and known mandatory charges and refundable deposits; lease duration and prorating
                are not included.
              </Text>
              <Text style={s.notice}>
                Only the public area is shown. No exact address or map pin is displayed. Synthetic
                details do not establish real availability.
              </Text>
            </View>
          ) : (
            <View>
              <Text accessibilityRole="header" style={s.title}>
                Explore approved listings
              </Text>
              <Text accessibilityLiveRegion="polite" style={s.copy}>
                {result.freshness === 'previous' ? 'Previously loaded: ' : ''}
                {result.searchPage?.total ?? shown.length} matching synthetic properties
              </Text>
              <Text style={s.notice}>Applied filters: {mobileReferenceSearchSummary(search)}</Text>
              {result.searchPage && (
                <View>
                  <Text style={s.copy}>
                    {shown.length ? result.searchPage.offset + 1 : 0}–
                    {result.searchPage.offset + shown.length} of {result.searchPage.total}
                  </Text>
                  {result.searchPage.offset > 0 && (
                    <CatalogueButton
                      label="Previous search page"
                      disabled={result.freshness === 'previous'}
                      onPress={() => {
                        setResult(null);
                        setSearch({ ...search, offset: Math.max(0, (search.offset ?? 0) - 24) });
                      }}
                      styles={s}
                    />
                  )}
                  {result.searchPage.hasMore &&
                    result.searchPage.offset + 24 <= result.searchPage.maxOffset && (
                      <CatalogueButton
                        label="Next search page"
                        disabled={result.freshness === 'previous'}
                        onPress={() => {
                          setResult(null);
                          setSearch({ ...search, offset: (search.offset ?? 0) + 24 });
                        }}
                        styles={s}
                      />
                    )}
                  {result.searchPage.hasMore &&
                    result.searchPage.offset + 24 > result.searchPage.maxOffset && (
                      <Text style={s.copy}>
                        Narrow your search to see more matching properties within the paging limit.
                      </Text>
                    )}
                </View>
              )}
              {result.mayBeTruncated && (
                <Text style={s.notice}>
                  This is a bounded page. Additional properties may exist; search covers only the
                  loaded page.
                </Text>
              )}
              {shown.length === 0 && <Text style={s.copy}>No properties match this search.</Text>}
              {shown.map((item) => (
                <CatalogueCard
                  key={item.property.id}
                  label={`View ${item.property.title}, ${item.base}${item.property.rentPeriod ? ` per ${item.property.rentPeriod}` : ''}`}
                  onPress={() => setSelected(item)}
                  styles={s}
                >
                  <Text accessibilityRole="header" style={s.heading}>
                    {item.property.title}
                  </Text>
                  <Text style={s.copy}>{item.location}</Text>
                  <Text style={s.price}>
                    {item.base}
                    {item.property.rentPeriod ? ` / ${item.property.rentPeriod}` : ''}
                  </Text>
                  <Text style={s.notice}>View details and additional costs →</Text>
                </CatalogueCard>
              ))}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
