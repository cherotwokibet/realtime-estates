import type { PricingDisclosure } from '@realtor/domain';
import { getPricingPresentation, type PricingChargePresentation } from './pricing-presentation';

export interface PricingDisclosureProps {
  readonly pricing: PricingDisclosure;
  /** Synthetic concept context only; never changes supplied prices or cost completeness. */
  readonly preview?: boolean;
}

function ChargeList({ charges }: { readonly charges: readonly PricingChargePresentation[] }) {
  return <ul className="pricing-disclosure__charges">
    {charges.map(charge => <li className="pricing-disclosure__charge" key={charge.id}>
      <span className="pricing-disclosure__charge-name"><strong>{charge.name}</strong><small>{charge.classification} · {charge.timing}</small></span>
      <span className={`pricing-disclosure__amount${charge.quoteRequired ? ' pricing-disclosure__quote' : ''}`}>{charge.amount}</span>
    </li>)}
  </ul>;
}

export function PricingDisclosureCard({ pricing, preview = false }: PricingDisclosureProps) {
  const view = getPricingPresentation(pricing);
  return <section className="pricing-disclosure" aria-label="Price and additional costs">
    <header className="pricing-disclosure__header">
      <p className="pricing-disclosure__eyebrow">{preview ? 'SYNTHETIC CONCEPT AMOUNTS' : 'PRICE DISCLOSURE'}</p>
      <h2>Price &amp; costs</h2>
      <p>{view.baseLabel}</p>
      <p className="pricing-disclosure__base"><strong>{view.baseAmount}</strong>{view.period && <span className="pricing-disclosure__period"> / {view.period}</span>}</p>
    </header>
    <div className={`pricing-disclosure__status pricing-disclosure__status--${view.status.kind}`}>
      <p><strong>{view.status.title}</strong></p><p>{view.status.detail}</p>
    </div>
    <div className="pricing-disclosure__section">
      <h3>Named mandatory charges</h3>
      {view.mandatoryCharges.length > 0 ? <ChargeList charges={view.mandatoryCharges} /> : <p className="pricing-disclosure__note">No mandatory charge rows supplied. Confirm additional costs with the agency.</p>}
    </div>
    <dl className="pricing-disclosure__rows">
      {view.knownRecurringSubtotal !== null && <>
        <div className="pricing-disclosure__row"><dt>Known mandatory recurring charges <span className="pricing-disclosure__period">/ {view.period}</span></dt><dd>{view.knownRecurringFees}</dd></div>
        <div className="pricing-disclosure__row"><dt>Known recurring subtotal <span className="pricing-disclosure__period">/ {view.period}</span></dt><dd>{view.knownRecurringSubtotal}</dd></div>
      </>}
      <div className="pricing-disclosure__row"><dt>Known mandatory one-off fees</dt><dd>{view.knownOneOffFees}</dd></div>
      <div className="pricing-disclosure__row"><dt>Known mandatory refundable deposits</dt><dd>{view.knownRefundableDeposit}</dd></div>
      <div className="pricing-disclosure__row pricing-disclosure__initial"><dt>Known initial subtotal</dt><dd>{view.knownInitialSubtotal}</dd></div>
    </dl>
    <p className="pricing-disclosure__note">{view.initialNote}</p>
    {view.optionalCharges.length > 0 && <div className="pricing-disclosure__section pricing-disclosure__optional">
      <h3>Optional costs</h3>
      <p className="pricing-disclosure__note">Shown separately from mandatory subtotals. These apply only if chosen.</p>
      <ChargeList charges={view.optionalCharges} />
      <dl className="pricing-disclosure__rows"><div className="pricing-disclosure__row"><dt>{view.optionalExtrasLabel}</dt><dd>{view.optionalKnownInitialExtras}</dd></div></dl>
      <p className="pricing-disclosure__note">{view.optionalExtrasNote}</p>
    </div>}
    {preview && <p className="pricing-disclosure__note">Synthetic concept amounts for design review. Confirm actual property costs independently.</p>}
  </section>;
}

/** Non-interactive compact copy, safe to place inside an existing property-card link. */
export function PricingDisclosureSummary({ pricing, preview = false }: PricingDisclosureProps) {
  const view = getPricingPresentation(pricing);
  return <div className="pricing-summary">
    {view.knownRecurringSubtotal !== null && <p className="pricing-summary__recurring"><span>Known recurring subtotal </span><strong>{view.knownRecurringSubtotal}</strong><span> / {view.period}</span></p>}
    <p><span>Known initial subtotal </span><strong>{view.knownInitialSubtotal}</strong></p>
    <p className={`pricing-summary__status pricing-summary__status--${view.status.kind}`}>{view.status.title}{preview && ' · Synthetic concept'}</p>
    {view.mandatoryQuoteNames.length > 0 && <p className="pricing-summary__quote">Mandatory amounts to confirm: {view.mandatoryQuoteNames.join(', ')}.</p>}
  </div>;
}
