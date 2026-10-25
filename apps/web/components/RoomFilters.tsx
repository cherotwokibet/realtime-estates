/** Server-rendered GET fields: blank is unrestricted; zero is an explicit declared count. */
export default function RoomFilters({
  bedsText,
  privateBathsText,
  sharedBathsText,
  errorFields,
}: {
  bedsText: string;
  privateBathsText: string;
  sharedBathsText: string;
  errorFields: readonly string[];
}) {
  return (
    <fieldset className="room-filters">
      <legend>Room counts</legend>
      {[
        { name: 'beds', label: 'Bedrooms (exact)', value: bedsText },
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
        Blank includes unknown counts. A selected count requires a declared value; shared bathrooms
        do not count as private bathrooms.
      </p>
    </fieldset>
  );
}
