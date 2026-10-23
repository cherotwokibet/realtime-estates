import React, { useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import {
  getDemoBrand,
  getDemoTheme,
  propertiesForCompany,
  resolveDemoTenantSlug,
  type DemoProperty,
} from '@realtor/demo';
import { searchCatalogue } from '@realtor/demo/search';
import { formatKes, kesFromMinor } from '@realtor/domain';

const tenantSlug = resolveDemoTenantSlug(Constants.expoConfig?.extra?.tenantSlug);
const brand = getDemoBrand(tenantSlug);
const theme = getDemoTheme(tenantSlug);
const catalogue = propertiesForCompany(tenantSlug);
const photos = {
  studio: require('../assets/demo/studio-room.jpg'),
  bedsitter: require('../assets/demo/bedsitter-room.jpg'),
};
const tabs = ['Home', 'Search', 'Saved', 'Profile'] as const;
type Tab = (typeof tabs)[number];
type Purpose = '' | 'rent' | 'sale';
type Filters = { location: string; max: string; purpose: Purpose };
const emptyFilters: Filters = { location: '', max: '', purpose: '' };
const money = (property: DemoProperty) => formatKes(kesFromMinor(property.priceMinor));
const roomLabel = (property: DemoProperty) =>
  property.bedrooms === null
    ? 'Bedrooms not applicable'
    : property.bedrooms === 0
      ? property.type === 'studio'
        ? 'Studio'
        : 'Bedsitter'
      : `${property.bedrooms} bedrooms`;
const bathLabel = (property: DemoProperty) =>
  property.bathrooms === null
    ? 'Bathrooms not specified'
    : `${property.bathrooms} bath${property.bathrooms === 1 ? '' : 's'}`;
const photoFor = (property: DemoProperty) =>
  property.type === 'bedsitter' ? photos.bedsitter : photos.studio;

function NavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const color = active ? brand.primary : '#667085';
  if (tab === 'Home')
    return (
      <View accessible={false} style={s.iconBox}>
        <View style={[s.homeRoof, { borderColor: color }]} />
        <View style={[s.homeBase, { borderColor: color }]} />
      </View>
    );
  if (tab === 'Search')
    return (
      <View accessible={false} style={s.iconBox}>
        <View style={[s.searchCircle, { borderColor: color }]} />
        <View style={[s.searchHandle, { backgroundColor: color }]} />
      </View>
    );
  if (tab === 'Profile')
    return (
      <View accessible={false} style={s.iconBox}>
        <View style={[s.profileHead, { borderColor: color }]} />
        <View style={[s.profileBody, { borderColor: color }]} />
      </View>
    );
  return (
    <View accessible={false} style={s.iconBox}>
      <Text accessible={false} style={[s.heartIcon, { color }]}>
        ♡
      </Text>
    </View>
  );
}

function PurposeChips({
  value,
  onChange,
}: {
  value: Purpose;
  onChange: (purpose: Purpose) => void;
}) {
  return (
    <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Property purpose">
      {(
        [
          ['', 'All homes'],
          ['rent', 'For rent'],
          ['sale', 'For sale'],
        ] as const
      ).map(([purpose, label]) => (
        <Pressable
          key={purpose}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === purpose }}
          onPress={() => onChange(purpose)}
          style={[
            s.chip,
            value === purpose && { backgroundColor: brand.primary, borderColor: brand.primary },
          ]}
        >
          <Text style={[s.chipText, value === purpose && s.onPrimary]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PropertyCard({
  property,
  saved,
  onOpen,
  onSave,
}: {
  property: DemoProperty;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  return (
    <View style={s.card}>
      <View style={s.photoWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${property.title}`}
          onPress={onOpen}
        >
          <Image
            source={photoFor(property)}
            style={s.photo}
            accessibilityLabel="AI-generated room concept, illustrative only"
          />
        </Pressable>
        <View style={s.photoBadge}>
          <Text style={s.photoBadgeText}>AI CONCEPT</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${saved ? 'Remove from' : 'Add to'} saved: ${property.title}`}
          accessibilityState={{ selected: saved }}
          onPress={onSave}
          style={s.saveButton}
        >
          <Text accessible={false} style={[s.saveHeart, { color: brand.primary }]}>
            {saved ? '♥' : '♡'}
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${property.title}, ${money(property)}${property.rentalPeriod ? ' per ' + property.rentalPeriod : ''}, ${property.neighbourhood}. View details.`}
        onPress={onOpen}
        style={s.cardBody}
      >
        <View style={s.cardTop}>
          <Text style={[s.purpose, { color: brand.primary }]}>
            {property.purpose === 'rent' ? 'FOR RENT' : 'FOR SALE'}
          </Text>
          <Text style={s.type}>{property.type}</Text>
        </View>
        <Text style={s.price}>
          {money(property)}
          <Text style={s.period}>{property.rentalPeriod ? ` / ${property.rentalPeriod}` : ''}</Text>
        </Text>
        <Text accessibilityRole="header" style={s.cardTitle}>
          {property.title}
        </Text>
        <Text style={s.location}>
          {property.neighbourhood} · {property.county}
        </Text>
        <View style={s.specs}>
          <Text style={s.specText}>{roomLabel(property)}</Text>
          <Text style={s.specText}>{bathLabel(property)}</Text>
          <Text style={s.specText}>{property.areaSqm} m²</Text>
        </View>
      </Pressable>
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Home');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(emptyFilters);
  const [savedIds, setSavedIds] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<DemoProperty | null>(null);
  const results = searchCatalogue(tenantSlug, filters);
  const savedProperties = catalogue.filter((property) => savedIds.includes(property.id));
  const shown = tab === 'Saved' ? savedProperties : tab === 'Search' ? results.items : catalogue;
  const chooseTab = (next: Tab) => {
    setTab(next);
    if (next === 'Search') setDraftFilters(filters);
  };
  const toggleSaved = (property: DemoProperty) => {
    const alreadySaved = savedIds.includes(property.id);
    setSavedIds((ids) =>
      ids.includes(property.id) ? ids.filter((id) => id !== property.id) : [...ids, property.id],
    );
    AccessibilityInfo.announceForAccessibility(
      alreadySaved ? 'Removed from your session shortlist.' : 'Saved to your session shortlist.',
    );
  };
  const clearSearch = () => {
    setFilters(emptyFilters);
    setDraftFilters(emptyFilters);
  };
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View style={[s.initials, { borderColor: brand.accent }]}>
          <Text style={[s.initialsText, { color: brand.primary }]}>{brand.initials}</Text>
        </View>
        <View style={s.brandCopy}>
          <Text style={s.brand}>{brand.name}</Text>
          <Text style={s.tagline}>LIVE WHERE YOU LOVE</Text>
        </View>
      </View>
      <View style={s.preview}>
        <Text style={s.previewText}>Illustrative preview · no live listings</Text>
      </View>
      <ScrollView key={tab} keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
        {tab === 'Home' && (
          <>
            <View style={s.intro}>
              <Text style={[s.eyebrow, { color: brand.primary }]}>FIND YOUR NEXT CHAPTER</Text>
              <Text accessibilityRole="header" style={s.title}>
                A place to call home.
              </Text>
              <Text style={s.copy}>Explore homes and spaces, with the details that matter.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search properties by location and budget"
                onPress={() => chooseTab('Search')}
                style={s.quickSearch}
              >
                <NavIcon tab="Search" active />
                <Text style={s.quickSearchText}>Where would you like to live?</Text>
                <Text accessible={false} style={{ color: brand.primary }}>
                  →
                </Text>
              </Pressable>
            </View>
            <View style={s.sectionHeading}>
              <Text accessibilityRole="header" style={s.sectionTitle}>
                Explore the collection
              </Text>
              <Text style={s.count}>{catalogue.length} examples</Text>
            </View>
          </>
        )}
        {tab === 'Search' && (
          <>
            <Text accessibilityRole="header" style={s.title}>
              Find your place.
            </Text>
            <Text style={s.copy}>
              Search the synthetic catalogue. Rental examples are priced per month.
            </Text>
            <View style={s.searchPanel}>
              <PurposeChips
                value={draftFilters.purpose}
                onChange={(purpose) => setDraftFilters((current) => ({ ...current, purpose }))}
              />
              <Text style={s.inputLabel} nativeID="location-label">
                Location
              </Text>
              <TextInput
                accessibilityLabel="Location"
                accessibilityLabelledBy="location-label"
                value={draftFilters.location}
                onChangeText={(location) =>
                  setDraftFilters((current) => ({ ...current, location }))
                }
                placeholder="Neighbourhood or county"
                placeholderTextColor="#667085"
                autoCapitalize="words"
                style={s.input}
                returnKeyType="next"
              />
              <Text style={s.inputLabel} nativeID="budget-label">
                Maximum base price (KES)
              </Text>
              <TextInput
                accessibilityLabel="Maximum base price in Kenyan shillings"
                accessibilityLabelledBy="budget-label"
                value={draftFilters.max}
                onChangeText={(max) => setDraftFilters((current) => ({ ...current, max }))}
                placeholder="Any budget"
                placeholderTextColor="#667085"
                keyboardType="decimal-pad"
                style={s.input}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFilters({ ...draftFilters });
                  AccessibilityInfo.announceForAccessibility(
                    'Search filters applied. Results appear below.',
                  );
                }}
                style={[s.primary, { backgroundColor: brand.primary }]}
              >
                <Text style={s.primaryText}>Show matching properties</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={clearSearch} style={s.textButton}>
                <Text style={[s.textButtonText, { color: brand.primary }]}>Clear filters</Text>
              </Pressable>
            </View>
            {results.error ? (
              <Text accessibilityRole="alert" style={s.error}>
                {results.error}
              </Text>
            ) : (
              <Text accessibilityLiveRegion="polite" style={s.resultSummary}>
                {results.items.length} demo {results.items.length === 1 ? 'result' : 'results'} ·{' '}
                {filters.purpose === 'sale'
                  ? 'For sale'
                  : filters.purpose === 'rent'
                    ? 'Monthly rentals'
                    : 'Rent and sale'}
                {filters.location ? ` · ${filters.location}` : ''}
                {filters.max ? ` · maximum KES ${filters.max}` : ''}
              </Text>
            )}
          </>
        )}
        {tab === 'Saved' && (
          <>
            <Text accessibilityRole="header" style={s.title}>
              Your shortlist.
            </Text>
            <Text style={s.copy}>
              Saved for this app session only. Account sync and persistent storage are not
              connected.
            </Text>
          </>
        )}
        {tab === 'Profile' ? (
          <>
            <Text accessibilityRole="header" style={s.title}>
              Your space.
            </Text>
            <Text style={s.copy}>This preview does not sign you in or create an account.</Text>
            <View style={s.profileCard}>
              <Text style={[s.eyebrow, { color: brand.primary }]}>AGENCY</Text>
              <Text style={s.sectionTitle}>{brand.name}</Text>
              <Text style={s.copy}>
                You're exploring an independently built property experience with synthetic examples.
              </Text>
              <View style={s.divider} />
              <Text style={s.inputLabel}>Account and activity</Text>
              <Text style={s.copy}>
                Sign-in, enquiry receipts and viewing updates will appear here when the protected
                service is connected.
              </Text>
            </View>
            <View style={s.infoBox}>
              <Text style={s.infoTitle}>Preview privacy</Text>
              <Text style={s.copy}>
                Search and saved choices stay in memory for this session. No enquiry, booking or
                contact information is submitted.
              </Text>
            </View>
          </>
        ) : shown.length ? (
          shown.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              saved={savedIds.includes(property.id)}
              onOpen={() => setSelected(property)}
              onSave={() => toggleSaved(property)}
            />
          ))
        ) : (
          <View style={s.empty}>
            <Text accessibilityRole="header" style={s.sectionTitle}>
              {tab === 'Saved'
                ? 'Keep a shortlist.'
                : results.error
                  ? 'Check your filters.'
                  : 'No matches this time.'}
            </Text>
            <Text style={s.copy}>
              {tab === 'Saved'
                ? 'Tap the heart on a property to save it for this session.'
                : 'Try another location or budget in the demo catalogue.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                clearSearch();
                setTab(tab === 'Saved' ? 'Home' : 'Search');
              }}
              style={[s.primary, { backgroundColor: brand.primary }]}
            >
              <Text style={s.primaryText}>
                {tab === 'Saved' ? 'Explore properties' : 'Reset search'}
              </Text>
            </Pressable>
          </View>
        )}
        {tab !== 'Profile' && (
          <Text style={s.disclosure}>
            AI concepts are reused for illustration. They do not depict the exact property type,
            room count or real availability.
          </Text>
        )}
      </ScrollView>
      <View style={s.navigation} accessibilityRole="tablist" accessibilityLabel="Main navigation">
        {tabs.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityLabel={item === 'Saved' ? `Saved, ${savedIds.length} properties` : item}
            accessibilityState={{ selected: tab === item }}
            onPress={() => chooseTab(item)}
            style={[s.navItem, tab === item && s.navSelected]}
          >
            <NavIcon tab={item} active={tab === item} />
            <Text style={[s.navLabel, tab === item && { color: brand.primary, fontWeight: '700' }]}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={selected !== null}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
        accessibilityViewIsModal
      >
        <SafeAreaView style={s.safe}>
          {selected && (
            <>
              <View style={s.detailHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close property details"
                  onPress={() => setSelected(null)}
                  style={s.closeButton}
                >
                  <Text style={[s.textButtonText, { color: brand.primary }]}>← Back</Text>
                </Pressable>
                <Text style={s.detailHeaderText}>Property details</Text>
              </View>
              <ScrollView contentContainerStyle={s.detailPage}>
                <Image
                  source={photoFor(selected)}
                  style={s.detailPhoto}
                  accessibilityLabel="Reused AI-generated room concept, not a photograph of this listing"
                />
                <View style={s.detailBody}>
                  <Text style={[s.purpose, { color: brand.primary }]}>
                    SYNTHETIC LISTING · AI CONCEPT IMAGE
                  </Text>
                  <Text accessibilityRole="header" style={s.detailTitle}>
                    {selected.title}
                  </Text>
                  <Text style={s.location}>
                    {selected.neighbourhood} · {selected.county}
                  </Text>
                  <Text style={s.detailPrice}>
                    {money(selected)}
                    <Text style={s.period}>
                      {selected.rentalPeriod ? ` / ${selected.rentalPeriod}` : ''}
                    </Text>
                  </Text>
                  <View style={s.specs}>
                    <Text style={s.specText}>{roomLabel(selected)}</Text>
                    <Text style={s.specText}>{bathLabel(selected)}</Text>
                    <Text style={s.specText}>{selected.areaSqm} m²</Text>
                  </View>
                  <Text style={s.copy}>{selected.description}</Text>
                  <Text accessibilityRole="header" style={s.sectionTitle}>
                    Features
                  </Text>
                  {selected.amenities.map((amenity) => (
                    <Text key={amenity} style={s.feature}>
                      ✓ {amenity}
                    </Text>
                  ))}
                  <Text style={s.copy}>
                    Additional fees: no amounts supplied for this synthetic example. The displayed
                    base price is not an all-in quote.
                  </Text>
                  <View style={s.infoBox}>
                    <Text style={s.infoTitle}>Explore the experience</Text>
                    <Text style={s.copy}>
                      This image concept is reused across demo records and does not document this
                      property's type or room count. Enquiries, contact and viewing requests are not
                      connected.
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: savedIds.includes(selected.id) }}
                    onPress={() => toggleSaved(selected)}
                    style={[s.primary, { backgroundColor: brand.primary }]}
                  >
                    <Text style={s.primaryText}>
                      {savedIds.includes(selected.id)
                        ? 'Remove from shortlist'
                        : 'Save for this session'}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 15,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef0f2',
  },
  initials: {
    width: 44,
    height: 44,
    borderWidth: 1.5,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: { fontWeight: '800', fontSize: 17 },
  brandCopy: { flex: 1 },
  brand: { fontSize: 16, fontWeight: '700', color: '#20242b' },
  tagline: { fontSize: 10, color: '#606875', letterSpacing: 1.5, marginTop: 4 },
  preview: { backgroundColor: '#faf5f3', paddingHorizontal: 22, paddingVertical: 9 },
  previewText: { fontSize: 12, color: '#673131' },
  page: { paddingHorizontal: 20, paddingTop: 23, paddingBottom: 30 },
  intro: { marginBottom: 28 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { fontSize: 31, lineHeight: 38, fontWeight: '700', color: '#20242b', marginTop: 10 },
  copy: { fontSize: 15, lineHeight: 23, color: '#596371', marginTop: 10, marginBottom: 10 },
  quickSearch: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cdd2da',
    borderRadius: 12,
    padding: 13,
    minHeight: 55,
    marginTop: 14,
  },
  quickSearchText: { flex: 1, fontSize: 14, color: '#596371' },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 17,
  },
  sectionTitle: { fontSize: 20, lineHeight: 27, fontWeight: '700', color: '#20242b' },
  count: { fontSize: 12, color: '#596371' },
  card: {
    borderWidth: 1,
    borderColor: '#e1e4e9',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: '#fff',
    marginBottom: 23,
  },
  photoWrap: { position: 'relative' },
  photo: { width: '100%', aspectRatio: 1.5, backgroundColor: '#f1efec' },
  photoBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: '#ffffff',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 5,
  },
  photoBadgeText: { fontSize: 10, color: '#4b3535', fontWeight: '700', letterSpacing: 0.6 },
  saveButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  saveHeart: { fontSize: 27, lineHeight: 32 },
  cardBody: { padding: 18 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  purpose: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  type: { fontSize: 12, color: '#596371', textTransform: 'capitalize' },
  price: { fontSize: 23, lineHeight: 31, fontWeight: '700', color: '#20242b', marginTop: 9 },
  period: { fontSize: 13, fontWeight: '400', color: '#596371' },
  cardTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600', color: '#20242b', marginTop: 5 },
  location: { fontSize: 13, lineHeight: 20, color: '#596371', marginTop: 5 },
  specs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    paddingTop: 13,
    marginTop: 13,
    borderTopWidth: 1,
    borderTopColor: '#eef0f2',
  },
  specText: { fontSize: 12, lineHeight: 19, color: '#45505e' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    borderWidth: 1,
    borderColor: '#cdd2da',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#344054' },
  onPrimary: { color: theme.colors.onPrimary },
  searchPanel: {
    marginVertical: 17,
    padding: 17,
    borderWidth: 1,
    borderColor: '#e1e4e9',
    borderRadius: 14,
  },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#344054', marginTop: 8, marginBottom: 7 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#aeb7c3',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#20242b',
    marginBottom: 10,
  },
  primary: {
    minHeight: theme.minimumControlSize,
    borderRadius: theme.radius.control,
    paddingHorizontal: 17,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  primaryText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: theme.colors.onPrimary,
    textAlign: 'center',
  },
  textButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { fontSize: 14, fontWeight: '600' },
  resultSummary: { fontSize: 13, lineHeight: 21, color: '#45505e', marginBottom: 17 },
  error: { fontSize: 14, lineHeight: 22, color: '#991b1b', marginBottom: 17 },
  empty: { padding: 24, borderWidth: 1, borderColor: '#e1e4e9', borderRadius: 14, marginTop: 12 },
  disclosure: { fontSize: 12, lineHeight: 19, color: '#596371', marginTop: 1, marginBottom: 7 },
  navigation: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e6e8ed',
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 5,
    backgroundColor: '#fff',
  },
  navItem: {
    flex: 1,
    minHeight: 58,
    paddingVertical: 5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 11,
  },
  navSelected: { backgroundColor: '#faf3f3' },
  navLabel: { fontSize: 12, color: '#596371' },
  iconBox: { width: 24, height: 24, position: 'relative' },
  homeRoof: {
    position: 'absolute',
    top: 3,
    left: 5,
    width: 14,
    height: 14,
    borderTopWidth: 1.7,
    borderLeftWidth: 1.7,
    transform: [{ rotate: '45deg' }],
  },
  homeBase: {
    position: 'absolute',
    left: 5,
    top: 11,
    width: 14,
    height: 11,
    borderWidth: 1.7,
    borderTopWidth: 0,
    backgroundColor: '#fff',
  },
  searchCircle: {
    width: 15,
    height: 15,
    borderWidth: 1.8,
    borderRadius: 9,
    position: 'absolute',
    top: 2,
    left: 2,
  },
  searchHandle: {
    width: 9,
    height: 1.8,
    position: 'absolute',
    top: 18,
    left: 15,
    transform: [{ rotate: '45deg' }],
  },
  profileHead: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderWidth: 1.7,
    borderRadius: 6,
    left: 8,
    top: 1,
  },
  profileBody: {
    position: 'absolute',
    width: 19,
    height: 12,
    borderWidth: 1.7,
    borderRadius: 11,
    left: 3,
    top: 13,
  },
  heartIcon: { fontSize: 28, lineHeight: 28, textAlign: 'center' },
  profileCard: {
    borderWidth: 1,
    borderColor: '#e1e4e9',
    borderRadius: 14,
    padding: 21,
    marginTop: 18,
  },
  divider: { height: 1, backgroundColor: '#e1e4e9', marginVertical: 16 },
  infoBox: { padding: 18, borderRadius: 12, backgroundColor: '#f6f7f9', marginVertical: 18 },
  infoTitle: { fontSize: 15, fontWeight: '700', color: '#344054' },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e4e9',
  },
  closeButton: { minHeight: 55, minWidth: 74, justifyContent: 'center' },
  detailHeaderText: { fontSize: 15, fontWeight: '600', color: '#344054' },
  detailPage: { paddingBottom: 30 },
  detailPhoto: { width: '100%', aspectRatio: 1.3 },
  detailBody: { padding: 22 },
  detailTitle: { fontSize: 28, lineHeight: 35, fontWeight: '700', color: '#20242b', marginTop: 14 },
  detailPrice: { fontSize: 27, lineHeight: 36, fontWeight: '700', color: '#20242b', marginTop: 19 },
  feature: { fontSize: 14, lineHeight: 23, color: '#45505e', marginTop: 8 },
});
