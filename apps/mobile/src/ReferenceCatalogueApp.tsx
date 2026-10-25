import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getDemoBrand, getDemoTheme } from '@realtor/demo';
import { formatKes } from '@realtor/domain';
import {
  loadMobileReferenceCatalogue,
  type MobileReferenceConfig,
  type MobileReferenceItem,
  type MobileReferenceResult,
} from './reference-catalogue';
import { createReferenceCatalogueStyles } from './reference-theme';

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
  const brand = getDemoBrand(config.tenantSlug);
  const theme = useMemo(() => getDemoTheme(config.tenantSlug), [config.tenantSlug]);
  const s = useMemo(() => StyleSheet.create(createReferenceCatalogueStyles(theme)), [theme]);
  const [queryFocused, setQueryFocused] = useState(false);
  const [result, setResult] = useState<MobileReferenceResult | null>(null);
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ location: '', offset: 0 });
  const [selected, setSelected] = useState<MobileReferenceItem | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult(null);
    setSelected(null);
    void loadMobileReferenceCatalogue(config, {
      signal: controller.signal,
      search: { ...search, limit: 24 },
    }).then((value) => {
      if (active) setResult(value);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [config, request, search]);
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
        {!selected && (
          <View>
            <TextInput
              accessibilityLabel="Search public location"
              value={query}
              onChangeText={setQuery}
              placeholder="Town, county or area"
              onFocus={() => setQueryFocused(true)}
              onBlur={() => setQueryFocused(false)}
              selectionColor={theme.components.focus.color}
              placeholderTextColor={theme.components.feedback.help.foreground}
              style={[s.input, queryFocused && s.inputFocused, queryFocused && s.focused]}
            />
            <CatalogueButton
              label="Search all approved properties"
              onPress={() => setSearch({ location: query, offset: 0 })}
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
            Loading approved property details…
          </Text>
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
                {result.searchPage?.total ?? shown.length} matching synthetic properties
              </Text>
              {result.searchPage && (
                <View>
                  <Text style={s.copy}>
                    {shown.length ? result.searchPage.offset + 1 : 0}–
                    {result.searchPage.offset + shown.length} of {result.searchPage.total}
                  </Text>
                  {result.searchPage.offset > 0 && (
                    <CatalogueButton
                      label="Previous search page"
                      onPress={() =>
                        setSearch({ ...search, offset: Math.max(0, search.offset - 24) })
                      }
                      styles={s}
                    />
                  )}
                  {result.searchPage.hasMore &&
                    result.searchPage.offset + 24 <= result.searchPage.maxOffset && (
                      <CatalogueButton
                        label="Next search page"
                        onPress={() => setSearch({ ...search, offset: search.offset + 24 })}
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
