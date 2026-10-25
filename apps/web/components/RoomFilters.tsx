/** Server-rendered GET fields: blank is unrestricted; zero is an explicit declared count. */
export default function RoomFilters({
  bedsText,
  bedsMode,
  privateBathsText,
  sharedBathsText,
  errorFields,
}: {
  bedsText: string;
  bedsMode: string;
  privateBathsText: string;
  sharedBathsText: string;
  errorFields: readonly string[];
}) {
  return (
    <fieldset className="room-filters">
      <legend>Room counts</legend>
      <label className="search-field">
        <span>Bedroom comparison</span>
        <select
          name="bedsMode"
          defaultValue={bedsMode}
          {...(errorFields.includes('bedsMode')
            ? { 'aria-invalid': true as const, 'aria-describedby': 'search-error' }
            : {})}
        >
          <option value="">Exactly</option>
          <option value="at_least">At least</option>
          {bedsMode && bedsMode !== 'at_least' && (
            <option value={bedsMode}>Unsupported comparison: {bedsMode}</option>
          )}
        </select>
      </label>
      {[
        { name: 'beds', label: 'Bedrooms', value: bedsText },
        { name: 'privateBaths', label: 'Private bathrooms (minimum)', value: privateBathsText },
        { name: 'sharedBaths', label: 'Shared bathrooms (minimum)', value: sharedBathsText },
      ].map((field) => (
        <label className="search-field" key={field.name}>
          <span>{field.label}</span>
          <input
            name={field.name}
            type="number"
            min="0"
            max="100"
            step="1"
            placeholder="Any count"
            defaultValue={field.value}
            {...(errorFields.includes(field.name)
              ? { 'aria-invalid': true as const, 'aria-describedby': 'search-error' }
              : {})}
          />
        </label>
      ))}
      <p className="search-help">
        To include 7+ bedrooms, choose At least and enter 7. Exactly keeps each count separate.
        Blank includes unknown counts. A selected count, including zero, requires a declared value;
        shared bathrooms do not count as private bathrooms.
      </p>
    </fieldset>
  );
}
