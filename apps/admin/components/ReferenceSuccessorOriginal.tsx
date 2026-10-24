import {
  validateSyntheticReferenceSuccessorCommand,
  snapshotListingReferenceAttributes,
  formatKes,
  kesFromMinor,
  type ListingReferenceCatalogue,
  type SyntheticReferenceSuccessorCommand,
} from '@realtor/domain';
/** Review the historical original, including exact costs, before explicit recovery/replay. */
export default function ReferenceSuccessorOriginal({
  command,
  catalogue,
}: {
  command: SyntheticReferenceSuccessorCommand;
  catalogue: ListingReferenceCatalogue;
}) {
  const original = validateSyntheticReferenceSuccessorCommand(command, catalogue),
    content = original.content,
    attributes = snapshotListingReferenceAttributes(
      original.selection,
      catalogue,
      content.propertyType,
    );
  return (
    <section aria-label="Retained original facts">
      <h2>Retained original facts</h2>
      <p>
        Existing listing: {original.listingId}. Operation: {original.operationId}. Listing version:{' '}
        {original.expectedListingVersion}. Predecessor revision: {original.predecessor.revision},
        version {original.predecessor.version}, {original.predecessor.state}. Original catalogue:{' '}
        {catalogue.version}. These are historical facts; the current editable draft requires a fresh
        read.
      </p>
      <dl>
        {Object.entries(content)
          .filter(([key]) => !['location', 'pricing'].includes(key))
          .map(([key, value]) => (
            <div key={key}>
              <dt>{key === 'amountMinor' ? 'Base price' : key.replace(/([A-Z])/g, ' $1')}</dt>
              <dd>
                {value === null
                  ? 'Unknown'
                  : key === 'amountMinor'
                    ? formatKes(kesFromMinor(value as number))
                    : String(value)}
              </dd>
            </div>
          ))}
      </dl>
      <p>
        Public location:{' '}
        {[
          attributes.location.county?.label,
          attributes.location.locality?.label,
          attributes.location.neighbourhood?.label,
        ]
          .filter(Boolean)
          .join(' / ') || 'Unknown'}
        .
      </p>
      <p>
        Amenities:{' '}
        {attributes.amenities.length
          ? attributes.amenities.map((row) => row.label).join(', ')
          : 'Known empty selection'}
        .
      </p>
      <p>Cost declaration: {content.pricing.declaration.replaceAll('_', ' ')}.</p>
      <ul>
        {content.pricing.charges.map((charge) => (
          <li key={charge.id}>
            {charge.name}:{' '}
            {charge.amountMinor === null
              ? 'Quote required'
              : formatKes(kesFromMinor(charge.amountMinor))}
            ; {charge.timing.replaceAll('_', ' ')};{' '}
            {charge.classification === 'refundable_deposit' ? 'refundable deposit' : 'fee'};{' '}
            {charge.mandatory ? 'mandatory' : 'optional'}.
          </li>
        ))}
      </ul>
      {content.pricing.charges.length === 0 && (
        <p>
          {content.pricing.declaration === 'complete'
            ? 'No additional charges declared.'
            : 'Additional costs are not fully declared.'}
        </p>
      )}
    </section>
  );
}
