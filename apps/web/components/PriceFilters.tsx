/** Explicit lower comparison and inclusive maximum, using exact KES amounts. */
export default function PriceFilters({
  minText,
  minMode,
  maxText,
  errorFields,
}: {
  minText: string;
  minMode: string;
  maxText: string;
  errorFields: readonly string[];
}) {
  return (
    <>
      <label className="search-field">
        <span>Minimum price comparison</span>
        <select
          name="minMode"
          defaultValue={minMode}
          {...(errorFields.includes('minMode')
            ? { 'aria-invalid': true as const, 'aria-describedby': 'search-error' }
            : {})}
        >
          <option value="">At least</option>
          <option value="over">Over (excludes equal price)</option>
          {minMode && minMode !== 'over' && (
            <option value={minMode}>Unsupported comparison: {minMode}</option>
          )}
        </select>
      </label>
      {[
        {
          name: 'min',
          label: 'Minimum base price (KES)',
          value: minText,
          placeholder: 'No minimum',
        },
        {
          name: 'max',
          label: 'Maximum base price (KES)',
          value: maxText,
          placeholder: 'No maximum',
        },
      ].map((field) => (
        <label className="search-field" key={field.name}>
          <span>{field.label}</span>
          <input
            name={field.name}
            type="number"
            min="0.01"
            step="0.01"
            defaultValue={field.value}
            placeholder={field.placeholder}
            {...(errorFields.includes(field.name)
              ? { 'aria-invalid': true as const, 'aria-describedby': 'search-error' }
              : {})}
          />
        </label>
      ))}
    </>
  );
}
