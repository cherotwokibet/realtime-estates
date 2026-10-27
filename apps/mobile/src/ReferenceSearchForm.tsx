import React, { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { PROPERTY_TYPES } from '@realtor/domain';
import type { createReferenceCatalogueStyles } from './reference-theme';
import type { MobileReferenceFilters } from './reference-search';

type Styles = ReturnType<typeof createReferenceCatalogueStyles>;
function SearchField({
  label,
  value,
  onChange,
  styles: s,
  inputMode = 'text',
  maxLength = 160,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  styles: Styles;
  inputMode?: TextInputProps['inputMode'];
  maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <Text style={s.copy}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        inputMode={inputMode}
        maxLength={maxLength}
        autoCapitalize="none"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[s.input, focused && s.inputFocused, focused && s.focused]}
      />
    </View>
  );
}
function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  styles: s,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  styles: Styles;
}) {
  const [focusedOption, setFocusedOption] = useState<T | null>(null);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text accessibilityRole="header" style={s.heading}>
        {label}
      </Text>
      {options.map(([option, text]) => (
        <Pressable
          key={option || 'any'}
          accessibilityRole="radio"
          accessibilityLabel={text}
          accessibilityState={{ checked: value === option }}
          onPress={() => onChange(option)}
          onFocus={() => setFocusedOption(option)}
          onBlur={() => setFocusedOption(null)}
          style={({ pressed }) => [
            s.button,
            (value === option || pressed) && s.buttonPressed,
            focusedOption === option && s.focused,
          ]}
        >
          {({ pressed }) => (
            <Text style={[s.buttonText, (value === option || pressed) && s.buttonPressedText]}>
              {value === option ? '● ' : '○ '}
              {text}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}
export function ReferenceSearchForm({
  filters,
  onChange,
  styles: s,
}: {
  filters: MobileReferenceFilters;
  onChange: (filters: MobileReferenceFilters) => void;
  styles: Styles;
}) {
  const [expanded, setExpanded] = useState(false);
  const [toggleFocused, setToggleFocused] = useState(false);
  const set = <K extends keyof MobileReferenceFilters>(key: K, value: MobileReferenceFilters[K]) =>
    onChange({ ...filters, [key]: value });
  return (
    <View>
      <SearchField
        label="Public location"
        value={filters.location}
        onChange={(value) => set('location', value)}
        styles={s}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        onFocus={() => setToggleFocused(true)}
        onBlur={() => setToggleFocused(false)}
        style={({ pressed }) => [s.button, pressed && s.buttonPressed, toggleFocused && s.focused]}
      >
        {({ pressed }) => (
          <Text style={[s.buttonText, pressed && s.buttonPressedText]}>
            {expanded ? 'Hide filters' : 'Show filters'}
          </Text>
        )}
      </Pressable>
      {expanded && (
        <View>
          <Choices
            label="Purpose"
            value={filters.purpose}
            options={[
              ['', 'All purposes'],
              ['rent', 'For rent'],
              ['sale', 'For sale'],
            ]}
            onChange={(value) =>
              onChange({
                ...filters,
                purpose: value,
                period: value === 'rent' ? filters.period : '',
              })
            }
            styles={s}
          />
          <Choices
            label="Property type"
            value={filters.type}
            options={[['', 'All types'], ...PROPERTY_TYPES.map((type) => [type, type] as const)]}
            onChange={(value) => set('type', value)}
            styles={s}
          />
          {filters.purpose === 'rent' && (
            <Choices
              label="Rental period"
              value={filters.period}
              options={[
                ['', 'Any period'],
                ['day', 'Day'],
                ['week', 'Week'],
                ['month', 'Month'],
                ['year', 'Year'],
              ]}
              onChange={(value) => set('period', value)}
              styles={s}
            />
          )}
          <Text style={s.notice}>
            Price filters use the base KES amount. For rent, choose one period to compare equivalent
            prices.
          </Text>
          <SearchField
            label="Minimum base price in KES"
            value={filters.min}
            onChange={(value) => set('min', value)}
            styles={s}
            inputMode="decimal"
            maxLength={24}
          />
          <Choices
            label="Minimum price comparison"
            value={filters.minMode}
            options={[
              ['', 'At least'],
              ['over', 'Strictly over'],
            ]}
            onChange={(value) => set('minMode', value)}
            styles={s}
          />
          <SearchField
            label="Maximum base price in KES"
            value={filters.max}
            onChange={(value) => set('max', value)}
            styles={s}
            inputMode="decimal"
            maxLength={24}
          />
          <SearchField
            label="Bedrooms (0 for an open-plan room)"
            value={filters.beds}
            onChange={(value) => set('beds', value)}
            styles={s}
            inputMode="numeric"
            maxLength={3}
          />
          <Choices
            label="Bedroom comparison"
            value={filters.bedsMode}
            options={[
              ['', 'Exactly'],
              ['at_least', 'At least'],
            ]}
            onChange={(value) => set('bedsMode', value)}
            styles={s}
          />
          <SearchField
            label="Minimum private bathrooms"
            value={filters.privateBaths}
            onChange={(value) => set('privateBaths', value)}
            styles={s}
            inputMode="numeric"
            maxLength={3}
          />
          <SearchField
            label="Minimum shared bathrooms"
            value={filters.sharedBaths}
            onChange={(value) => set('sharedBaths', value)}
            styles={s}
            inputMode="numeric"
            maxLength={3}
          />
          <Choices
            label="Result order"
            value={filters.sort}
            options={[
              ['catalogue', 'Catalogue order'],
              ['title', 'Title'],
              ['price_low', 'Lowest price first'],
              ['price_high', 'Highest price first'],
            ]}
            onChange={(value) => set('sort', value)}
            styles={s}
          />
        </View>
      )}
    </View>
  );
}
