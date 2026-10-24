import type { ListingCreationCommand, ListingSuccessorCommand } from '@realtor/api-client';
import { formatKes, kesFromMinor } from '@realtor/domain';
export default function AllocationOriginal({
  command,
}: {
  command: ListingCreationCommand | ListingSuccessorCommand;
}) {
  const content = command.content;
  return (
    <section aria-label="Retained original facts">
      <h2>Retained original facts</h2>
      <p>
        Listing {command.listingId} · operation {command.operationId}
      </p>
      {'slug' in command ? (
        <p>Slug: {command.slug}</p>
      ) : (
        <p>
          Original listing version {command.expectedListingVersion} · predecessor revision{' '}
          {command.predecessor.revision} · version {command.predecessor.version} ·{' '}
          {command.predecessor.state}
        </p>
      )}
      <p>
        These are historical original facts. A confirmed receipt identifies the draft; its current
        editable versions require a fresh read.
      </p>
      <dl>
        {Object.entries(content)
          .filter(([k]) => !['pricing', 'location'].includes(k))
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
        Original location:{' '}
        {Object.values(content.location)
          .map((v) => v ?? 'Unknown')
          .join(' / ')}
      </p>
      <p>Cost declaration: {content.pricing.declaration.replaceAll('_', ' ')}</p>
      {content.pricing.charges.map((charge) => (
        <div key={charge.id}>
          <h3>{charge.name}</h3>
          <p>
            {charge.amountMinor === null
              ? 'Amount unknown'
              : formatKes(kesFromMinor(charge.amountMinor))}{' '}
            · {charge.amountStatus} · {charge.timing} · {charge.classification} ·{' '}
            {charge.mandatory ? 'Mandatory' : 'Optional'}
          </p>
        </div>
      ))}
      {content.pricing.charges.length === 0 && <p>No declared charges in this original.</p>}
    </section>
  );
}
