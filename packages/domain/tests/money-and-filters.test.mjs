import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kesFromMajor,
  kesFromMinor,
  formatKes,
  calculatePriceBreakdown,
  matchesNumericRange,
  exactNumericRange,
  normalizeKenyanPhone,
} from '../dist/index.js';

test('KES decimal text becomes exact minor units without floating point rounding', () => {
  assert.equal(kesFromMajor('25000.01').minorUnits, 2_500_001);
  assert.equal(kesFromMajor('0.1').minorUnits, 10);
  assert.equal(kesFromMajor('00015.50').minorUnits, 1550);
  assert.equal(formatKes(kesFromMajor('25000.01')), 'KES 25,000.01');
  assert.equal(formatKes(kesFromMajor('25000')), 'KES 25,000');
});
test('money rejects silent precision loss, currency coercion, negatives and formatted user text', () => {
  for (const input of ['1.005', '1e4', '-100', '25,000', '', ' 12', '.2', 'KES 12', 25])
    assert.throws(() => kesFromMajor(input));
  for (const input of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => kesFromMinor(input));
  assert.throws(() => formatKes({ currency: 'USD', minorUnits: 100 }));
  assert.throws(() => kesFromMajor('90071992547409.92'));
  assert.equal(kesFromMajor('90071992547409.91').minorUnits, Number.MAX_SAFE_INTEGER);
});
const fees = [
  {
    id: 'service',
    name: 'Service charge',
    amount: kesFromMajor('1500'),
    timing: 'per_rental_period',
    refundable: false,
  },
  {
    id: 'lease',
    name: 'Lease preparation',
    amount: kesFromMajor('2000'),
    timing: 'one_off',
    refundable: false,
  },
  {
    id: 'deposit',
    name: 'Refundable deposit',
    amount: kesFromMajor('25000'),
    timing: 'one_off',
    refundable: true,
  },
];
test('rent quote discloses refundable deposit separately and does not count it as recurring income', () => {
  const total = calculatePriceBreakdown(kesFromMajor('25000'), fees, 'rent');
  assert.equal(total.recurringTotal.minorUnits, 2_650_000);
  assert.equal(total.refundableDeposit.minorUnits, 2_500_000);
  assert.equal(total.nonRefundableOneOff.minorUnits, 200_000);
  assert.equal(total.dueAtStart.minorUnits, 5_350_000);
});
test('fee totals reject duplicates, zero amounts, rental fees on sales, and recurring deposits', () => {
  const base = kesFromMajor('25000');
  assert.throws(() => calculatePriceBreakdown(base, [fees[0], fees[0]], 'rent'));
  assert.throws(() =>
    calculatePriceBreakdown(base, [{ ...fees[0], amount: kesFromMinor(0) }], 'rent'),
  );
  assert.throws(() => calculatePriceBreakdown(base, [fees[0]], 'sale'));
  assert.throws(() =>
    calculatePriceBreakdown(base, [{ ...fees[2], timing: 'per_rental_period' }], 'rent'),
  );
  assert.throws(() =>
    calculatePriceBreakdown(kesFromMinor(Number.MAX_SAFE_INTEGER), [fees[0]], 'rent'),
  );
  const sale = calculatePriceBreakdown(kesFromMajor('5000000'), [], 'sale');
  assert.equal(sale.recurringTotal.minorUnits, 0);
  assert.equal(sale.dueAtStart.minorUnits, 500_000_000);
});
test('Over is strict at the boundary; inclusive ranges and exact counts preserve 7, 8, 9, 10', () => {
  const over = { min: { value: 1_000_000, inclusive: false } };
  assert.equal(matchesNumericRange(999_999, over), false);
  assert.equal(matchesNumericRange(1_000_000, over), false);
  assert.equal(matchesNumericRange(1_000_001, over), true);
  const inclusive = {
    min: { value: 1_000_000, inclusive: true },
    max: { value: 2_000_000, inclusive: true },
  };
  assert.equal(matchesNumericRange(1_000_000, inclusive), true);
  assert.equal(matchesNumericRange(2_000_000, inclusive), true);
  assert.equal(matchesNumericRange(2_000_001, inclusive), false);
  assert.deepEqual(
    [7, 8, 9, 10].filter((value) =>
      matchesNumericRange(value, { min: { value: 7, inclusive: true } }),
    ),
    [7, 8, 9, 10],
  );
  assert.deepEqual(
    [0, 7, 8, 9, 10].filter((value) => matchesNumericRange(value, exactNumericRange(7))),
    [7],
  );
  assert.equal(matchesNumericRange(0, exactNumericRange(0)), true);
});
test('ranges fail clearly when contradictory or non-finite instead of silently yielding misleading results', () => {
  assert.throws(() =>
    matchesNumericRange(10, {
      min: { value: 20, inclusive: true },
      max: { value: 10, inclusive: true },
    }),
  );
  assert.throws(() =>
    matchesNumericRange(10, {
      min: { value: 10, inclusive: false },
      max: { value: 10, inclusive: true },
    }),
  );
  assert.throws(() => matchesNumericRange(10, { min: { value: Infinity, inclusive: true } }));
  assert.equal(matchesNumericRange(NaN, {}), false);
});
test('Kenyan mobile contact normalization supports explicit 07/01 forms with formatting', () => {
  for (const input of ['0700000000', '+254700000000', '254700000000', '(0700) 000-000'])
    assert.equal(normalizeKenyanPhone(input), '+254700000000');
  for (const input of ['0100000000', '+254100000000', '254100000000', '0100 000 000'])
    assert.equal(normalizeKenyanPhone(input), '+254100000000');
});
test('unsupported country/prefix, truncated number, double plus and extensions are rejected', () => {
  for (const input of [
    '+255700000000',
    '+2540700000000',
    '0200000000',
    '700000000',
    '070000000',
    '07000000000',
    '++254700000000',
    '0700000000 ext 1',
    '0700000000/0700000001',
    '',
  ])
    assert.throws(() => normalizeKenyanPhone(input));
});
