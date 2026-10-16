import { DomainError, requireText } from './errors.js';
import {
  assertKes,
  calculatePriceBreakdown,
  kesFromMinor,
  RENTAL_PERIODS,
  type FeeTiming,
  type KesMoney,
  type RentalPeriod,
} from './money.js';
import { MAX_LISTING_PRICE_MINOR } from './property.js';

export type ChargeClassification = 'fee' | 'refundable_deposit';
interface DisclosedChargeFields {
  readonly id: string;
  readonly name: string;
  readonly timing: FeeTiming;
  readonly classification: ChargeClassification;
  readonly mandatory: boolean;
}
export type DisclosedCharge = DisclosedChargeFields &
  (
    | { readonly amountStatus: 'known'; readonly amount: KesMoney }
    | { readonly amountStatus: 'quote_required'; readonly amount: null }
  );
export interface PricingDisclosureInput {
  readonly base: KesMoney;
  readonly purpose: 'rent' | 'sale';
  readonly rentalPeriod: RentalPeriod | null;
  readonly charges: readonly DisclosedCharge[];
  /** Declares coverage of the supplied charges, not independent verification of taxes or fees. */
  readonly disclosure?: 'complete' | 'incomplete';
}
export interface KnownMandatoryCosts {
  readonly recurringFees: KesMoney;
  /** A sale has no rental-period amount, represented by null rather than a recurring zero price. */
  readonly recurringSubtotal: KesMoney | null;
  readonly oneOffFees: KesMoney;
  readonly refundableDeposit: KesMoney;
  /** Base/first period + mandatory recurring fees + one-off fees + refundable deposits. */
  readonly initialSubtotal: KesMoney;
}
export interface OptionalCosts {
  readonly charges: readonly DisclosedCharge[];
  readonly knownRecurringFees: KesMoney;
  readonly knownOneOffFees: KesMoney;
  readonly knownRefundableDeposit: KesMoney;
  /** Known first-period extras if every listed optional cost is chosen; excludes the base. */
  readonly knownInitialExtras: KesMoney;
  readonly quoteRequiredChargeIds: readonly string[];
}
export interface PricingDisclosure {
  readonly base: KesMoney;
  readonly purpose: 'rent' | 'sale';
  readonly rentalPeriod: RentalPeriod | null;
  readonly charges: readonly DisclosedCharge[];
  readonly knownMandatory: KnownMandatoryCosts;
  readonly optionalCosts: OptionalCosts;
  readonly disclosureDeclaration: 'complete' | 'incomplete' | 'not_declared';
  /** Complete only for explicitly disclosed mandatory costs with no mandatory quote outstanding. */
  readonly mandatoryAmountsComplete: boolean;
  /** Includes incomplete/undeclared coverage, even when no named quote-required charge is supplied. */
  readonly hasUnresolvedMandatoryAmounts: boolean;
  readonly unresolvedMandatoryChargeIds: readonly string[];
}

function invalid(message: string): never {
  throw new DomainError('INVALID_CHARGE', message);
}
function sumAmounts(values: readonly KesMoney[]): KesMoney {
  // Values have already passed assertKes; BigInt prevents loss before the final safe-integer check.
  const minorUnits = values.reduce((sum, amount) => sum + BigInt(amount.minorUnits), 0n);
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('INVALID_MONEY', 'Total exceeds the safe integer limit.');
  }
  return kesFromMinor(Number(minorUnits));
}

function validateCharge(
  charge: DisclosedCharge,
  purpose: 'rent' | 'sale',
  ids: Set<string>,
): DisclosedCharge {
  if (!charge || typeof charge !== 'object' || Array.isArray(charge))
    return invalid('A named charge is required.');
  const id = requireText(charge.id, 'Charge ID');
  const name = requireText(charge.name, 'Charge name');
  if (ids.has(id)) return invalid('Charge IDs must be unique across mandatory and optional costs.');
  ids.add(id);
  if (typeof charge.mandatory !== 'boolean')
    return invalid('State whether each charge is mandatory.');
  if (charge.classification !== 'fee' && charge.classification !== 'refundable_deposit')
    return invalid('Choose a charge classification.');
  if (charge.timing !== 'one_off' && charge.timing !== 'per_rental_period')
    return invalid('Choose a supported charge timing.');
  if (purpose === 'sale' && charge.timing === 'per_rental_period')
    return invalid('Sale listings cannot have rental-period charges.');
  if (charge.classification === 'refundable_deposit' && charge.timing !== 'one_off')
    return invalid('Refundable deposits must be one-off amounts.');
  const fields: DisclosedChargeFields = {
    id,
    name,
    timing: charge.timing,
    classification: charge.classification,
    mandatory: charge.mandatory,
  };
  if (charge.amountStatus === 'known') {
    assertKes(charge.amount);
    if (charge.amount.minorUnits === 0)
      return invalid('A known charge must have a positive amount.');
    return Object.freeze({
      ...fields,
      amountStatus: 'known',
      amount: kesFromMinor(charge.amount.minorUnits),
    });
  }
  if (charge.amountStatus === 'quote_required' && charge.amount === null) {
    return Object.freeze({ ...fields, amountStatus: 'quote_required', amount: null });
  }
  return invalid('A charge requires a known KES amount or an explicit quote-required null amount.');
}

/**
 * Discloses supplied amounts without treating missing costs as zero. All results are known
 * subtotals; even a complete mandatory declaration is not an all-inclusive/tax verification claim.
 * This extends the domain contract only; persisted listing fees retain their separate initial model.
 */
export function calculatePricingDisclosure(input: PricingDisclosureInput): PricingDisclosure {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('INVALID_PRICING', 'Pricing details are required.');
  }
  assertKes(input.base);
  if (input.base.minorUnits <= 0 || input.base.minorUnits > MAX_LISTING_PRICE_MINOR) {
    throw new DomainError(
      'INVALID_PRICE',
      'A base price must be positive and within the supported listing limit.',
    );
  }
  if (input.purpose !== 'rent' && input.purpose !== 'sale') {
    throw new DomainError('INVALID_PURPOSE', 'Choose rent or sale.');
  }
  if (
    (input.purpose === 'rent' && !RENTAL_PERIODS.includes(input.rentalPeriod as RentalPeriod)) ||
    (input.purpose === 'sale' && input.rentalPeriod !== null)
  ) {
    throw new DomainError(
      'INVALID_RENTAL_PERIOD',
      'Rent needs an explicit period; sale needs a null period.',
    );
  }
  if (
    input.disclosure !== undefined &&
    input.disclosure !== 'complete' &&
    input.disclosure !== 'incomplete'
  ) {
    throw new DomainError(
      'INVALID_DISCLOSURE',
      'Declare complete or incomplete cost coverage, or leave it undeclared.',
    );
  }
  if (!Array.isArray(input.charges))
    return invalid('Supply a charge array; omitted charges cannot be treated as zero.');
  const ids = new Set<string>();
  const charges: readonly DisclosedCharge[] = Object.freeze(
    Array.from(input.charges, (charge) => validateCharge(charge, input.purpose, ids)),
  );
  const knownMandatoryCharges = charges.filter(
    (charge) => charge.mandatory && charge.amountStatus === 'known',
  );
  const mandatory = calculatePriceBreakdown(
    input.base,
    knownMandatoryCharges.map((charge) => {
      // The filter above narrows the runtime set; this branch also narrows its discriminated type.
      if (charge.amountStatus !== 'known') return invalid('Expected a known amount.');
      return {
        id: charge.id,
        name: charge.name,
        amount: charge.amount,
        timing: charge.timing,
        refundable: charge.classification === 'refundable_deposit',
      };
    }),
    input.purpose,
  );
  const optionalCharges: readonly DisclosedCharge[] = Object.freeze(
    charges.filter((charge) => !charge.mandatory),
  );
  const knownOptional = optionalCharges.flatMap((charge) =>
    charge.amountStatus === 'known' ? [charge] : [],
  );
  const knownRecurringFees = sumAmounts(
    knownOptional
      .filter((charge) => charge.timing === 'per_rental_period')
      .map((charge) => charge.amount),
  );
  const knownOneOffFees = sumAmounts(
    knownOptional
      .filter((charge) => charge.timing === 'one_off' && charge.classification === 'fee')
      .map((charge) => charge.amount),
  );
  const knownRefundableDeposit = sumAmounts(
    knownOptional
      .filter((charge) => charge.classification === 'refundable_deposit')
      .map((charge) => charge.amount),
  );
  const unresolvedMandatoryChargeIds = Object.freeze(
    charges
      .filter((charge) => charge.mandatory && charge.amountStatus === 'quote_required')
      .map((charge) => charge.id),
  );
  const disclosureDeclaration = input.disclosure ?? 'not_declared';
  const mandatoryAmountsComplete =
    disclosureDeclaration === 'complete' && unresolvedMandatoryChargeIds.length === 0;
  return Object.freeze({
    base: mandatory.base,
    purpose: input.purpose,
    rentalPeriod: input.rentalPeriod,
    charges,
    knownMandatory: Object.freeze({
      recurringFees: mandatory.recurringFees,
      recurringSubtotal: input.purpose === 'rent' ? mandatory.recurringTotal : null,
      oneOffFees: mandatory.nonRefundableOneOff,
      refundableDeposit: mandatory.refundableDeposit,
      initialSubtotal: mandatory.dueAtStart,
    }),
    optionalCosts: Object.freeze({
      charges: optionalCharges,
      knownRecurringFees,
      knownOneOffFees,
      knownRefundableDeposit,
      knownInitialExtras: sumAmounts([knownRecurringFees, knownOneOffFees, knownRefundableDeposit]),
      quoteRequiredChargeIds: Object.freeze(
        optionalCharges
          .filter((charge) => charge.amountStatus === 'quote_required')
          .map((charge) => charge.id),
      ),
    }),
    disclosureDeclaration,
    mandatoryAmountsComplete,
    hasUnresolvedMandatoryAmounts: !mandatoryAmountsComplete,
    unresolvedMandatoryChargeIds,
  });
}
