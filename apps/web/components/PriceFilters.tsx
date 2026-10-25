/** Inclusive base-price bounds; blank does not constrain that side of the range. */
export default function PriceFilters({
  minText,
  maxText,
  errorFields,
}: {
  minText: string;
  maxText: string;
  errorFields: readonly string[];
}) {
  return (
    <>
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
