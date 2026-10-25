import {
  REFERENCE_FILTER_KEYS,
  type ReferenceFilters as Values,
  type ReferenceOptions,
} from '../lib/catalogue-reference-filters.ts';
export default function ReferenceFilters({
  values,
  options,
  invalid,
}: {
  values: Values;
  options: ReferenceOptions;
  invalid: readonly string[];
}) {
  if (
    !REFERENCE_FILTER_KEYS.some(
      (key) => values[key] || options[key].length || invalid.includes(key),
    )
  )
    return null;
  const labels = {
    countyId: 'County',
    localityId: 'Town / locality',
    neighbourhoodId: 'Neighbourhood',
    amenityId: 'Amenity',
  };
  return (
    <fieldset className="room-filters reference-filters">
      <legend>Locations and amenities</legend>
      {REFERENCE_FILTER_KEYS.map((key) => (
        <label className="search-field" key={key}>
          <span>{labels[key]}</span>
          <select
            name={key}
            defaultValue={values[key]}
            {...(invalid.includes(key)
              ? { 'aria-invalid': true as const, 'aria-describedby': 'search-error' }
              : {})}
          >
            <option value="">Any {labels[key].toLowerCase()}</option>
            {values[key] && !options[key].some((row) => row.id === values[key]) && (
              <option value={values[key]}>Selected option unavailable in loaded selection</option>
            )}
            {options[key].map((row) => (
              <option value={row.id} key={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p className="search-help">
        Choices come from the loaded properties. All selected locations and the amenity must match
        the same property. Properties without declared reference details cannot match these choices.
      </p>
    </fieldset>
  );
}
