import { DomainError, requireText } from './errors.js';

/** KES amounts are safe integer cents, never a formatted string or floating point shilling amount. */
export interface KesMoney {
  readonly currency: 'KES';
  readonly minorUnits: number;
}

export function kesFromMinor(minorUnits: number): KesMoney {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new DomainError('INVALID_MONEY', 'KES minor units must be a non-negative safe integer.');
  }
  return Object.freeze({ currency: 'KES', minorUnits });
}

/** Accept unformatted decimal text: at most two decimal places, with no rounding or exponent coercion. */
export function kesFromMajor(value: string): KesMoney {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new DomainError(
      'INVALID_MONEY',
      'Enter an unformatted KES amount with at most two decimal places.',
    );
  }
  const [whole = '', fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('INVALID_MONEY', 'KES amount exceeds the safe integer limit.');
  }
  return kesFromMinor(Number(minor));
}

export function assertKes(value: KesMoney): void {
  if (!value || value.currency !== 'KES')
    throw new DomainError('INVALID_CURRENCY', 'Only KES is supported in this pilot.');
  kesFromMinor(value.minorUnits);
}

export function formatKes(value: KesMoney): string {
  assertKes(value);
  const whole = Math.floor(value.minorUnits / 100).toLocaleString('en-KE');
  const cents = value.minorUnits % 100;
  return `KES ${whole}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

export type RentalPeriod = 'day' | 'week' | 'month' | 'year';
export const RENTAL_PERIODS: readonly RentalPeriod[] = Object.freeze([
  'day',
  'week',
  'month',
  'year',
]);
export type FeeTiming = 'one_off' | 'per_rental_period';
export interface ListingFee {
  readonly id: string;
  readonly name: string;
  readonly amount: KesMoney;
  readonly timing: FeeTiming;
  readonly refundable: boolean;
}
export interface PriceBreakdown {
  readonly base: KesMoney;
  readonly recurringFees: KesMoney;
  readonly nonRefundableOneOff: KesMoney;
  readonly refundableDeposit: KesMoney;
  readonly dueAtStart: KesMoney;
  readonly recurringTotal: KesMoney;
}

function sumMoney(amounts: readonly number[]): KesMoney {
  const total = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new DomainError('INVALID_MONEY', 'Total exceeds the safe integer limit.');
  return kesFromMinor(Number(total));
}

/** The first period/base payment plus named fees, with refundable money disclosed separately. */
export function calculatePriceBreakdown(
  base: KesMoney,
  fees: readonly ListingFee[],
  purpose: 'rent' | 'sale',
): PriceBreakdown {
  assertKes(base);
  if (base.minorUnits === 0)
    throw new DomainError('INVALID_PRICE', 'A listing price must be positive.');
  if (purpose !== 'rent' && purpose !== 'sale')
    throw new DomainError('INVALID_PURPOSE', 'Choose rent or sale.');
  const ids = new Set<string>();
  for (const fee of fees) {
    const id = requireText(fee.id, 'Fee ID');
    requireText(fee.name, 'Fee name');
    assertKes(fee.amount);
    if (fee.amount.minorUnits === 0 || ids.has(id))
      throw new DomainError('INVALID_FEE', 'Fee amounts must be positive and fee IDs unique.');
    ids.add(id);
    if (fee.timing !== 'one_off' && fee.timing !== 'per_rental_period')
      throw new DomainError('INVALID_FEE', 'Choose a supported fee timing.');
    if (typeof fee.refundable !== 'boolean')
      throw new DomainError('INVALID_FEE', 'A fee must state whether it is refundable.');
    if (fee.refundable && fee.timing !== 'one_off')
      throw new DomainError('INVALID_FEE', 'Refundable deposits must be one-off amounts.');
    if (purpose === 'sale' && fee.timing === 'per_rental_period')
      throw new DomainError('INVALID_FEE', 'Sale listings cannot have rental-period fees.');
  }
  const recurringFees = sumMoney(
    fees.filter((fee) => fee.timing === 'per_rental_period').map((fee) => fee.amount.minorUnits),
  );
  const nonRefundableOneOff = sumMoney(
    fees
      .filter((fee) => fee.timing === 'one_off' && !fee.refundable)
      .map((fee) => fee.amount.minorUnits),
  );
  const refundableDeposit = sumMoney(
    fees.filter((fee) => fee.refundable).map((fee) => fee.amount.minorUnits),
  );
  return Object.freeze({
    base: kesFromMinor(base.minorUnits),
    recurringFees,
    nonRefundableOneOff,
    refundableDeposit,
    dueAtStart: sumMoney([
      base.minorUnits,
      recurringFees.minorUnits,
      nonRefundableOneOff.minorUnits,
      refundableDeposit.minorUnits,
    ]),
    recurringTotal:
      purpose === 'rent' ? sumMoney([base.minorUnits, recurringFees.minorUnits]) : kesFromMinor(0),
  });
}
