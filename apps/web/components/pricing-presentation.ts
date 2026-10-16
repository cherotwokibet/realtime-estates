import {
  formatKes,
  type DisclosedCharge,
  type KesMoney,
  type PricingDisclosure,
} from '@realtor/domain';

export interface PricingChargePresentation {
  readonly id: string;
  readonly name: string;
  readonly amount: string;
  readonly timing: string;
  readonly classification: string;
  readonly quoteRequired: boolean;
}
export interface PricingPresentation {
  readonly baseLabel: string;
  readonly baseAmount: string;
  readonly period: string | null;
  readonly knownRecurringFees: string;
  readonly knownRecurringSubtotal: string | null;
  readonly knownOneOffFees: string;
  readonly knownRefundableDeposit: string;
  readonly knownInitialSubtotal: string;
  readonly initialNote: string;
  readonly optionalKnownInitialExtras: string;
  readonly optionalExtrasLabel: string;
  readonly optionalExtrasNote: string;
  readonly mandatoryCharges: readonly PricingChargePresentation[];
  readonly optionalCharges: readonly PricingChargePresentation[];
  readonly mandatoryQuoteNames: readonly string[];
  readonly status: Readonly<{ kind: 'complete' | 'incomplete'; title: string; detail: string }>;
}

function suppliedAmount(amount: KesMoney): string {
  return amount.minorUnits === 0 ? 'None supplied' : formatKes(amount);
}

/** Presentation only: every subtotal and completeness decision comes from the shared domain. */
export function getPricingPresentation(pricing: PricingDisclosure): PricingPresentation {
  const period = pricing.rentalPeriod;
  const describeCharge = (charge: DisclosedCharge): PricingChargePresentation =>
    Object.freeze({
      id: charge.id,
      name: charge.name,
      amount: charge.amountStatus === 'known' ? formatKes(charge.amount) : 'Amount to confirm',
      timing:
        charge.timing === 'one_off' ? 'One-off' : period ? `Per ${period}` : 'Per rental period',
      classification: charge.classification === 'refundable_deposit' ? 'Refundable deposit' : 'Fee',
      quoteRequired: charge.amountStatus === 'quote_required',
    });
  let title: string;
  let detail: string;
  if (pricing.disclosureDeclaration === 'not_declared') {
    title = 'Cost disclosure not supplied';
    detail =
      'A complete list of additional costs has not been supplied. These are known subtotals; further costs may apply.';
  } else if (pricing.disclosureDeclaration === 'incomplete') {
    title = 'Cost disclosure incomplete';
    detail =
      'The supplied cost list is incomplete. Confirm further charges with the agency before making a commitment.';
  } else if (!pricing.mandatoryAmountsComplete) {
    title = 'Mandatory amounts to confirm';
    detail =
      'At least one mandatory amount requires a quote. The known subtotal excludes those amounts.';
  } else {
    title = 'Declared mandatory amounts supplied';
    detail =
      'Confirm the supplied amounts and any applicable taxes or third-party costs with the agency before making a commitment.';
  }
  return Object.freeze({
    baseLabel: pricing.purpose === 'rent' ? 'Base rent' : 'Sale price',
    baseAmount: formatKes(pricing.base),
    period,
    knownRecurringFees: suppliedAmount(pricing.knownMandatory.recurringFees),
    knownRecurringSubtotal: pricing.knownMandatory.recurringSubtotal
      ? formatKes(pricing.knownMandatory.recurringSubtotal)
      : null,
    knownOneOffFees: suppliedAmount(pricing.knownMandatory.oneOffFees),
    knownRefundableDeposit: suppliedAmount(pricing.knownMandatory.refundableDeposit),
    knownInitialSubtotal: formatKes(pricing.knownMandatory.initialSubtotal),
    initialNote:
      pricing.purpose === 'rent'
        ? `One first ${period} plus known mandatory charges and refundable deposits. Lease duration and a prorated move-in date are not included in this calculation.`
        : 'Sale price plus known mandatory one-off fees and refundable amounts.',
    optionalKnownInitialExtras: suppliedAmount(pricing.optionalCosts.knownInitialExtras),
    optionalExtrasLabel:
      pricing.purpose === 'rent'
        ? 'Known optional first-period extras'
        : 'Known optional one-off extras',
    optionalExtrasNote:
      pricing.purpose === 'rent'
        ? 'Includes all supplied optional known amounts for one first rental period if chosen. Optional amounts awaiting a quote are excluded.'
        : 'Includes all supplied optional known one-off amounts if chosen. Optional amounts awaiting a quote are excluded.',
    mandatoryCharges: Object.freeze(
      pricing.charges.filter((charge) => charge.mandatory).map(describeCharge),
    ),
    optionalCharges: Object.freeze(pricing.optionalCosts.charges.map(describeCharge)),
    mandatoryQuoteNames: Object.freeze(
      pricing.charges
        .filter((charge) => charge.mandatory && charge.amountStatus === 'quote_required')
        .map((charge) => charge.name),
    ),
    status: Object.freeze({
      kind: pricing.mandatoryAmountsComplete ? 'complete' : 'incomplete',
      title,
      detail,
    }),
  });
}
