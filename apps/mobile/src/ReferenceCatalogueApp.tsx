import React, { useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getDemoBrand } from '@realtor/demo';
import { formatKes } from '@realtor/domain';
import {
  loadMobileReferenceCatalogue,
  searchMobileReferenceItems,
  type MobileReferenceConfig,
  type MobileReferenceItem,
  type MobileReferenceResult,
} from './reference-catalogue';

export function ReferenceCatalogueApp({
  config,
}: {
  config: Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>;
}) {
  const brand = getDemoBrand(config.tenantSlug);
  const [result, setResult] = useState<MobileReferenceResult | null>(null);
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MobileReferenceItem | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult(null);
    setSelected(null);
    void loadMobileReferenceCatalogue(config, { signal: controller.signal }).then((value) => {
      if (active) setResult(value);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [config, request]);
  const shown = result?.status === 'ready' ? searchMobileReferenceItems(result.items, query) : [];
  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text accessibilityRole="header" style={[s.brand, { color: brand.primary }]}>
          {brand.name}
        </Text>
        <Text style={s.notice}>Synthetic API preview · no real availability</Text>
        <Text style={s.copy}>Enquiries, contact and viewing requests are disabled.</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
        {result === null && (
          <Text accessibilityLiveRegion="polite">Loading approved property details…</Text>
        )}
        {result?.status === 'error' && (
          <View>
            <Text accessibilityRole="alert">The property catalogue could not be loaded.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setRequest((value) => value + 1)}
              style={s.button}
            >
              <Text>Try again</Text>
            </Pressable>
          </View>
        )}
        {result?.status === 'ready' &&
          (selected ? (
            <View style={s.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to property results"
                onPress={() => setSelected(null)}
                style={s.button}
              >
                <Text>← Back to results</Text>
              </Pressable>
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
                <Text>Not supplied</Text>
              ) : selected.amenities.length === 0 ? (
                <Text>No amenities selected in the approved listing.</Text>
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
                <Text>No named charges supplied.</Text>
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
              <TextInput
                accessibilityLabel="Search public location"
                value={query}
                onChangeText={setQuery}
                placeholder="Town, county or area"
                style={s.input}
              />
              <Text accessibilityLiveRegion="polite" style={s.copy}>
                {shown.length} synthetic {shown.length === 1 ? 'result' : 'results'}
              </Text>
              {result.mayBeTruncated && (
                <Text style={s.notice}>
                  This is a bounded page. Additional properties may exist; search covers only the
                  loaded page.
                </Text>
              )}
              {shown.length === 0 && <Text>No properties match this search.</Text>}
              {shown.map((item) => (
                <Pressable
                  key={item.property.id}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${item.property.title}, ${item.base}${item.property.rentPeriod ? ` per ${item.property.rentPeriod}` : ''}`}
                  onPress={() => setSelected(item)}
                  style={s.card}
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
                </Pressable>
              ))}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f7f2' },
  header: { padding: 20, backgroundColor: '#fff' },
  brand: { fontSize: 23, fontWeight: '700' },
  notice: { fontSize: 13, lineHeight: 20, color: '#475467', marginVertical: 8 },
  copy: { fontSize: 16, lineHeight: 25, color: '#26332b', marginVertical: 7 },
  page: { padding: 20, paddingBottom: 44 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700', color: '#26332b', marginVertical: 12 },
  heading: {
    fontSize: 21,
    lineHeight: 29,
    fontWeight: '600',
    marginVertical: 12,
    color: '#26332b',
  },
  price: { fontSize: 23, fontWeight: '700', color: '#26332b', marginVertical: 12 },
  card: { padding: 18, backgroundColor: '#fff', borderRadius: 16, marginVertical: 10 },
  button: {
    padding: 14,
    minHeight: 48,
    backgroundColor: '#edf0e9',
    borderRadius: 10,
    marginVertical: 12,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#667085',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
    fontSize: 16,
    color: '#26332b',
  },
});
