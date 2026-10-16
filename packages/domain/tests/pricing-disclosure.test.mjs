import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePricingDisclosure,
  DomainError,
  kesFromMajor,
  kesFromMinor,
  MAX_LISTING_PRICE_MINOR,
} from '../dist/index.js';

const fee = (id, amount, overrides = {}) => ({
  id,
  name: `Named ${id}`,
  amountStatus: 'known',
  amount: kesFromMajor(amount),
  classification: 'fee',
  mandatory: true,
  timing: 'one_off',
  ...overrides,
});
const quote = (id, overrides = {}) => ({
  id,
  name: `Quoted ${id}`,
  amountStatus: 'quote_required',
  amount: null,
  classification: 'fee',
  mandatory: true,
  timing: 'one_off',
  ...overrides,
});
const rent = (overrides = {}) => ({
  base: kesFromMajor('20000'),
  purpose: 'rent',
  rentalPeriod: 'month',
  charges: [],
  ...overrides,
});
const rejectsDomain = (callback) =>
  assert.throws(callback, (error) => {
    assert.ok(error instanceof DomainError, 'Malformed pricing should produce a domain error.');
    return true;
  });

test('sale 999999 + mandatory fee 1500 preserves the advertised price and shows known initial 1001499', () => {
  const result = calculatePricingDisclosure({
    base: kesFromMajor('999999'),
    purpose: 'sale',
    rentalPeriod: null,
    charges: [fee('conveyance', '1500')],
    disclosure: 'complete',
  });
  assert.equal(result.base.minorUnits, 99_999_900);
  assert.equal(result.knownMandatory.oneOffFees.minorUnits, 150_000);
  assert.equal(result.knownMandatory.initialSubtotal.minorUnits, 100_149_900);
  assert.equal(result.knownMandatory.refundableDeposit.minorUnits, 0);
  assert.equal(result.knownMandatory.recurringSubtotal, null);
  assert.equal(result.mandatoryAmountsComplete, true);
  assert.equal(result.hasUnresolvedMandatoryAmounts, false);
});

test('monthly 20000 + service 1000 + deposit 20000 + first fee 500 gives recurring 21000 and initial 41500', () => {
  const result = calculatePricingDisclosure(
    rent({
      disclosure: 'complete',
      charges: [
        fee('service', '1000', { timing: 'per_rental_period' }),
        fee('deposit', '20000', { classification: 'refundable_deposit' }),
        fee('preparation', '500'),
      ],
    }),
  );
  assert.equal(result.rentalPeriod, 'month');
  assert.equal(result.knownMandatory.recurringFees.minorUnits, 100_000);
  assert.equal(result.knownMandatory.recurringSubtotal.minorUnits, 2_100_000);
  assert.equal(result.knownMandatory.oneOffFees.minorUnits, 50_000);
  assert.equal(result.knownMandatory.refundableDeposit.minorUnits, 2_000_000);
  assert.equal(result.knownMandatory.initialSubtotal.minorUnits, 4_150_000);
  assert.equal(result.mandatoryAmountsComplete, true);
});

test('mandatory quotes remain unresolved even after a complete coverage declaration; only supplied amounts enter subtotals', () => {
  const result = calculatePricingDisclosure(
    rent({
      disclosure: 'complete',
      charges: [
        fee('known-service', '1000', { timing: 'per_rental_period' }),
        quote('unknown-service', { timing: 'per_rental_period' }),
        quote('unknown-deposit', { classification: 'refundable_deposit' }),
        quote('unknown-admin'),
      ],
    }),
  );
  assert.equal(result.disclosureDeclaration, 'complete');
  assert.equal(result.mandatoryAmountsComplete, false);
  assert.equal(result.hasUnresolvedMandatoryAmounts, true);
  assert.deepEqual(result.unresolvedMandatoryChargeIds, [
    'unknown-service',
    'unknown-deposit',
    'unknown-admin',
  ]);
  assert.equal(result.knownMandatory.recurringSubtotal.minorUnits, 2_100_000);
  assert.equal(result.knownMandatory.initialSubtotal.minorUnits, 2_100_000);
  assert.equal(result.charges.find((charge) => charge.id === 'unknown-deposit').amount, null);
});

test('optional known costs and optional quotes remain separate and do not inflate mandatory amounts', () => {
  const result = calculatePricingDisclosure(
    rent({
      disclosure: 'complete',
      rentalPeriod: 'week',
      charges: [
        fee('optional-service', '200', { mandatory: false, timing: 'per_rental_period' }),
        fee('optional-cleaning', '300', { mandatory: false }),
        fee('optional-deposit', '600', { mandatory: false, classification: 'refundable_deposit' }),
        quote('optional-upgrade', { mandatory: false }),
      ],
    }),
  );
  assert.equal(result.rentalPeriod, 'week');
  assert.equal(result.knownMandatory.recurringSubtotal.minorUnits, 2_000_000);
  assert.equal(result.knownMandatory.initialSubtotal.minorUnits, 2_000_000);
  assert.equal(result.knownMandatory.refundableDeposit.minorUnits, 0);
  assert.equal(result.optionalCosts.knownRecurringFees.minorUnits, 20_000);
  assert.equal(result.optionalCosts.knownOneOffFees.minorUnits, 30_000);
  assert.equal(result.optionalCosts.knownRefundableDeposit.minorUnits, 60_000);
  assert.equal(result.optionalCosts.knownInitialExtras.minorUnits, 110_000);
  assert.deepEqual(result.optionalCosts.quoteRequiredChargeIds, ['optional-upgrade']);
  assert.equal(result.optionalCosts.charges.length, 4);
  assert.deepEqual(result.unresolvedMandatoryChargeIds, []);
  assert.equal(result.mandatoryAmountsComplete, true);
  assert.equal(result.hasUnresolvedMandatoryAmounts, false);
});

test('empty charges never imply complete zero extras without an explicit complete declaration', () => {
  for (const disclosure of [undefined, 'incomplete', 'complete']) {
    const result = calculatePricingDisclosure(rent({ disclosure }));
    assert.equal(result.disclosureDeclaration, disclosure ?? 'not_declared');
    assert.equal(result.mandatoryAmountsComplete, disclosure === 'complete');
    assert.equal(result.hasUnresolvedMandatoryAmounts, disclosure !== 'complete');
    assert.equal(result.knownMandatory.initialSubtotal.minorUnits, 2_000_000);
    assert.deepEqual(result.unresolvedMandatoryChargeIds, []);
  }
  const supplied = calculatePricingDisclosure(rent({ charges: [fee('known', '1000')] }));
  assert.equal(
    supplied.mandatoryAmountsComplete,
    false,
    'Known supplied rows alone cannot establish coverage.',
  );
  assert.equal(supplied.hasUnresolvedMandatoryAmounts, true);
});

test('rent retains an explicitly chosen period and sale rejects every rental-period charge, including optional quotes', () => {
  for (const rentalPeriod of ['day', 'week', 'month', 'year']) {
    assert.equal(calculatePricingDisclosure(rent({ rentalPeriod })).rentalPeriod, rentalPeriod);
  }
  for (const rentalPeriod of [undefined, null, 'quarter', ''])
    rejectsDomain(() => calculatePricingDisclosure(rent({ rentalPeriod })));
  rejectsDomain(() => calculatePricingDisclosure(rent({ purpose: 'sale' })));
  for (const charge of [
    fee('recurring', '1', { timing: 'per_rental_period' }),
    quote('optional', { mandatory: false, timing: 'per_rental_period' }),
  ]) {
    rejectsDomain(() =>
      calculatePricingDisclosure(rent({ purpose: 'sale', rentalPeriod: null, charges: [charge] })),
    );
  }
});

test('named rows require unique trimmed IDs, nonblank labels, explicit flags and valid classifications/timing', () => {
  for (const charge of [
    undefined,
    null,
    {},
    fee(' ', '1'),
    fee('valid', '1', { name: '  ' }),
    fee('valid', '1', { mandatory: undefined }),
    fee('valid', '1', { mandatory: 'false' }),
    fee('valid', '1', { classification: 'deposit' }),
    fee('valid', '1', { timing: 'monthly' }),
    fee('valid', '1', { classification: 'refundable_deposit', timing: 'per_rental_period' }),
    quote('valid', { classification: 'refundable_deposit', timing: 'per_rental_period' }),
  ])
    rejectsDomain(() => calculatePricingDisclosure(rent({ charges: [charge] })));
  rejectsDomain(() =>
    calculatePricingDisclosure(
      rent({ charges: [fee('shared', '1'), quote(' shared ', { mandatory: false })] }),
    ),
  );
  rejectsDomain(() => calculatePricingDisclosure(rent({ charges: new Array(1) })));
});

test('known charges require positive safe integer KES; quotes require exactly null rather than zero or missing money', () => {
  for (const amount of [
    null,
    undefined,
    { currency: 'USD', minorUnits: 100 },
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100'].map((minorUnits) => ({
      currency: 'KES',
      minorUnits,
    })),
  ])
    rejectsDomain(() =>
      calculatePricingDisclosure(rent({ charges: [fee('invalid', '1', { amount })] })),
    );
  for (const amount of [undefined, 0, kesFromMinor(0), kesFromMajor('1')]) {
    rejectsDomain(() =>
      calculatePricingDisclosure(rent({ charges: [quote('invalid', { amount })] })),
    );
  }
  rejectsDomain(() =>
    calculatePricingDisclosure(
      rent({ charges: [fee('invalid', '1', { amountStatus: 'estimated' })] }),
    ),
  );
});

test('base prices retain the shared listing ceiling while safe computed totals may exceed it', () => {
  for (const base of [
    null,
    undefined,
    { currency: 'USD', minorUnits: 100 },
    ...[0, -1, 0.5, NaN, Infinity, MAX_LISTING_PRICE_MINOR + 1, Number.MAX_SAFE_INTEGER + 1].map(
      (minorUnits) => ({ currency: 'KES', minorUnits }),
    ),
  ])
    rejectsDomain(() => calculatePricingDisclosure(rent({ base })));
  const result = calculatePricingDisclosure(
    rent({
      base: kesFromMinor(MAX_LISTING_PRICE_MINOR),
      charges: [fee('large-fee', '1', { amount: kesFromMinor(MAX_LISTING_PRICE_MINOR) })],
    }),
  );
  assert.equal(result.knownMandatory.initialSubtotal.minorUnits, MAX_LISTING_PRICE_MINOR * 2);
});

test('mandatory and optional subtotal sums reject unsafe overflow without floating point truncation', () => {
  const huge = fee('huge', '1', { amount: kesFromMinor(Number.MAX_SAFE_INTEGER) });
  rejectsDomain(() => calculatePricingDisclosure(rent({ base: kesFromMinor(1), charges: [huge] })));
  rejectsDomain(() =>
    calculatePricingDisclosure(
      rent({
        charges: [{ ...huge, mandatory: false }, fee('extra', '0.01', { mandatory: false })],
      }),
    ),
  );
  rejectsDomain(() =>
    calculatePricingDisclosure(
      rent({
        charges: [
          { ...huge, mandatory: false, classification: 'refundable_deposit' },
          fee('extra', '0.01', { mandatory: false, timing: 'per_rental_period' }),
        ],
      }),
    ),
  );
});

test('malformed pricing containers, missing charge arrays and unsupported completeness declarations fail explicitly', () => {
  for (const input of [
    undefined,
    null,
    [],
    rent({ purpose: 'lease' }),
    rent({ charges: undefined }),
    rent({ charges: {} }),
    rent({ disclosure: true }),
    rent({ disclosure: 'unknown' }),
  ]) {
    rejectsDomain(() => calculatePricingDisclosure(input));
  }
});

test('pricing snapshots trim labels and deeply freeze detached money, charge arrays, subtotals and quote IDs', () => {
  const amount = { currency: 'KES', minorUnits: 100 };
  const base = { currency: 'KES', minorUnits: 2_000_000 };
  const charge = fee(' service ', '1', { name: ' Service charge ', amount });
  const optional = quote('optional', { mandatory: false });
  const charges = [charge, optional];
  const result = calculatePricingDisclosure(rent({ base, charges, disclosure: 'complete' }));
  amount.minorUnits = 999;
  base.minorUnits = 999;
  charge.name = 'Changed after calculation';
  charges.length = 0;
  assert.equal(result.base.minorUnits, 2_000_000);
  assert.equal(result.charges[0].amount.minorUnits, 100);
  assert.equal(result.charges[0].id, 'service');
  assert.equal(result.charges[0].name, 'Service charge');
  for (const value of [
    result,
    result.base,
    result.charges,
    ...result.charges,
    result.charges[0].amount,
    result.knownMandatory,
    ...Object.values(result.knownMandatory).filter(Boolean),
    result.optionalCosts,
    result.optionalCosts.charges,
    result.optionalCosts.knownInitialExtras,
    result.optionalCosts.quoteRequiredChargeIds,
    result.unresolvedMandatoryChargeIds,
  ])
    assert.ok(Object.isFrozen(value));
  assert.throws(() => {
    result.charges[0].amount.minorUnits = 2;
  }, TypeError);
  assert.throws(() => result.optionalCosts.quoteRequiredChargeIds.push('invented'), TypeError);
});
