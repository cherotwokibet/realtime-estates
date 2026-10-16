import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWirePricingV2,
  DomainError,
  kesFromMajor,
  kesFromMinor,
  validatePricingInputV2,
  validatePublicLocationV2,
} from '../dist/index.js';

const charge = (overrides = {}) => ({
  id: 'service',
  name: 'Service charge',
  amountStatus: 'known',
  amountMinor: 100_000,
  timing: 'per_rental_period',
  classification: 'fee',
  mandatory: true,
  ...overrides,
});
const pricing = (overrides = {}) => ({ declaration: 'not_declared', charges: [], ...overrides });
const location = (overrides = {}) => ({ county: null, town: null, area: null, ...overrides });
const rejectsContract = (callback) =>
  assert.throws(callback, (error) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'INVALID_LISTING_CONTRACT_V2');
    return true;
  });
const rejectsDomain = (callback) =>
  assert.throws(callback, (error) => error instanceof DomainError);

test('v2 pricing round-trips exact known and quote-required rows without supplied derived totals', () => {
  const input = pricing({
    declaration: 'incomplete',
    charges: [
      charge(),
      charge({
        id: 'quote',
        name: 'Deposit to confirm',
        amountStatus: 'quote_required',
        amountMinor: null,
        timing: 'one_off',
        classification: 'refundable_deposit',
      }),
    ],
  });
  const canonical = validatePricingInputV2(input);
  assert.deepEqual(canonical, input);
  assert.deepEqual(validatePricingInputV2(JSON.parse(JSON.stringify(canonical))), canonical);
  assert.equal(canonical.charges[1].amountMinor, null);
  rejectsContract(() => validatePricingInputV2({ ...input, initialTotal: 1 }));
  rejectsContract(() =>
    validatePricingInputV2(pricing({ charges: [{ ...charge(), refundable: false }] })),
  );
});

test('v2 wire requires every exact pricing and charge field and rejects wrong types or declaration aliases', () => {
  for (const input of [
    undefined,
    null,
    [],
    {},
    { charges: [] },
    { declaration: 'complete' },
    pricing({ declaration: 'unknown' }),
    pricing({ declaration: undefined }),
    pricing({ declaration: true }),
    pricing({ charges: null }),
    pricing({ charges: {} }),
  ]) {
    rejectsContract(() => validatePricingInputV2(input));
  }
  for (const key of Object.keys(charge())) {
    const incomplete = charge();
    delete incomplete[key];
    rejectsContract(() => validatePricingInputV2(pricing({ charges: [incomplete] })));
  }
  for (const overrides of [
    { id: 1 },
    { name: null },
    { amountStatus: 'estimated' },
    { timing: 'monthly' },
    { classification: 'deposit' },
    { mandatory: 'true' },
    { mandatory: null },
  ])
    rejectsContract(() => validatePricingInputV2(pricing({ charges: [charge(overrides)] })));
});

test('v2 wire cannot infer completeness from legacy fees or translate unknown cost coverage into zero', () => {
  const legacyFee = {
    id: 'old',
    name: 'Old fee',
    amount: kesFromMajor('1000'),
    timing: 'one_off',
    refundable: false,
  };
  rejectsContract(() => validatePricingInputV2({ fees: [legacyFee] }));
  rejectsContract(() => validatePricingInputV2(pricing({ charges: [legacyFee] })));
  for (const declaration of ['not_declared', 'incomplete', 'complete']) {
    const result = calculateWirePricingV2(
      kesFromMajor('20000'),
      'rent',
      'month',
      pricing({ declaration }),
    );
    assert.equal(result.disclosureDeclaration, declaration);
    assert.equal(result.mandatoryAmountsComplete, declaration === 'complete');
    assert.equal(result.hasUnresolvedMandatoryAmounts, declaration !== 'complete');
    assert.equal(result.knownMandatory.initialSubtotal.minorUnits, 2_000_000);
  }
});

test('charge bounds are inclusive, Unicode code-point based and reject controls or surrounding whitespace', () => {
  assert.equal(
    validatePricingInputV2(
      pricing({ charges: [charge({ id: 'x'.repeat(64), name: 'y'.repeat(160) })] }),
    ).charges.length,
    1,
  );
  assert.equal(
    validatePricingInputV2(
      pricing({ charges: [charge({ id: '🏠'.repeat(64), name: '🏠'.repeat(160) })] }),
    ).charges.length,
    1,
  );
  for (const overrides of [
    { id: 'x'.repeat(65) },
    { name: 'y'.repeat(161) },
    { id: '🏠'.repeat(65) },
    { name: '🏠'.repeat(161) },
    { id: '' },
    { name: '' },
    { id: ' service' },
    { id: 'service ' },
    { name: '\u00a0Name' },
    { name: 'Name\ufeff' },
    { id: 'ab\u0000cd' },
    { name: 'ab\ncd' },
    { name: 'ab\u007fcd' },
    { name: 'ab\u0085cd' },
    { name: '\ud800' },
    { id: '\udfff' },
  ])
    rejectsContract(() => validatePricingInputV2(pricing({ charges: [charge(overrides)] })));
});

test('charges require unique IDs and a dense plain array containing at most 32 rows', () => {
  const maximum = Array.from({ length: 32 }, (_, index) => charge({ id: `fee-${index}` }));
  assert.equal(validatePricingInputV2(pricing({ charges: maximum })).charges.length, 32);
  rejectsContract(() =>
    validatePricingInputV2(pricing({ charges: [...maximum, charge({ id: 'fee-33' })] })),
  );
  rejectsContract(() =>
    validatePricingInputV2(pricing({ charges: [charge(), charge({ mandatory: false })] })),
  );
  rejectsContract(() =>
    validatePricingInputV2(pricing({ charges: [charge(), charge({ id: ' service ' })] })),
  );
  rejectsContract(() => validatePricingInputV2(pricing({ charges: new Array(1) })));
  const decorated = [charge()];
  decorated.extra = true;
  rejectsContract(() => validatePricingInputV2(pricing({ charges: decorated })));
  class InheritedCharges extends Array {}
  rejectsContract(() =>
    validatePricingInputV2(pricing({ charges: new InheritedCharges(charge()) })),
  );
});

test('known amounts are positive safe integers while quote-required amounts are exactly null', () => {
  assert.equal(
    validatePricingInputV2(pricing({ charges: [charge({ amountMinor: Number.MAX_SAFE_INTEGER })] }))
      .charges[0].amountMinor,
    Number.MAX_SAFE_INTEGER,
  );
  for (const amountMinor of [
    0,
    -0,
    -1,
    0.1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '100',
    null,
    undefined,
    { currency: 'KES', minorUnits: 100 },
  ]) {
    rejectsContract(() => validatePricingInputV2(pricing({ charges: [charge({ amountMinor })] })));
  }
  for (const amountMinor of [0, undefined, '0', 100]) {
    rejectsContract(() =>
      validatePricingInputV2(
        pricing({ charges: [charge({ amountStatus: 'quote_required', amountMinor })] }),
      ),
    );
  }
});

test('plain exact records reject classes, inherited fields, accessors, hidden fields and symbol extras', () => {
  class PricingClass {
    declaration = 'complete';
    charges = [];
  }
  rejectsContract(() => validatePricingInputV2(new PricingClass()));
  rejectsContract(() => validatePricingInputV2(Object.create(pricing())));
  rejectsContract(() => validatePricingInputV2(pricing({ charges: [Object.create(charge())] })));
  rejectsContract(() => validatePricingInputV2({ ...pricing(), [Symbol('hidden')]: true }));
  const hidden = pricing();
  Object.defineProperty(hidden, 'declaration', { value: 'complete', enumerable: false });
  rejectsContract(() => validatePricingInputV2(hidden));
  let getterInvoked = false;
  const accessor = pricing();
  Object.defineProperty(accessor, 'declaration', {
    enumerable: true,
    get() {
      getterInvoked = true;
      return 'complete';
    },
  });
  rejectsContract(() => validatePricingInputV2(accessor));
  assert.equal(getterInvoked, false);
  const nullPrototype = Object.assign(Object.create(null), pricing());
  assert.deepEqual(validatePricingInputV2(nullPrototype), pricing());
});

test('public location preserves explicit unknowns and round-trips exact supplied county/town/area', () => {
  assert.deepEqual(validatePublicLocationV2(location()), { county: null, town: null, area: null });
  const input = location({ county: 'Nairobi', town: 'Nairobi', area: 'Kilimani' });
  const canonical = validatePublicLocationV2(input);
  assert.deepEqual(canonical, input);
  assert.deepEqual(validatePublicLocationV2(JSON.parse(JSON.stringify(canonical))), canonical);
  assert.equal(
    validatePublicLocationV2(location({ area: '🏠'.repeat(160) })).area,
    '🏠'.repeat(160),
  );
});

test('public location rejects absent keys, legacy locality/defaults, hidden data and invalid text', () => {
  for (const input of [
    undefined,
    null,
    [],
    {},
    { county: null, town: null },
    { locality: 'Nairobi' },
    location({ locality: 'Nairobi' }),
    Object.create(location()),
  ]) {
    rejectsContract(() => validatePublicLocationV2(input));
  }
  for (const key of ['county', 'town', 'area']) {
    for (const value of [
      undefined,
      0,
      false,
      '',
      ' ',
      ' Nairobi',
      'Nairobi ',
      'x'.repeat(161),
      '🏠'.repeat(161),
      'A\tB',
      'A\u009fB',
      '\ud800',
    ]) {
      rejectsContract(() => validatePublicLocationV2(location({ [key]: value })));
    }
  }
  rejectsContract(() => validatePublicLocationV2({ ...location(), [Symbol('extra')]: 'hidden' }));
});

test('v2 calculator delegates exact sale and rent totals and keeps deposits separate', () => {
  const sale = calculateWirePricingV2(
    kesFromMajor('999999'),
    'sale',
    null,
    pricing({
      declaration: 'complete',
      charges: [
        charge({ id: 'sale-fee', name: 'Sale fee', amountMinor: 150_000, timing: 'one_off' }),
      ],
    }),
  );
  assert.equal(sale.knownMandatory.initialSubtotal.minorUnits, 100_149_900);
  assert.equal(sale.base.minorUnits, 99_999_900);
  assert.equal(sale.knownMandatory.recurringSubtotal, null);
  const rent = calculateWirePricingV2(
    kesFromMajor('20000'),
    'rent',
    'month',
    pricing({
      declaration: 'complete',
      charges: [
        charge(),
        charge({
          id: 'deposit',
          name: 'Refundable deposit',
          amountMinor: 2_000_000,
          timing: 'one_off',
          classification: 'refundable_deposit',
        }),
        charge({
          id: 'initial-fee',
          name: 'Preparation fee',
          amountMinor: 50_000,
          timing: 'one_off',
        }),
      ],
    }),
  );
  assert.equal(rent.knownMandatory.recurringSubtotal.minorUnits, 2_100_000);
  assert.equal(rent.knownMandatory.refundableDeposit.minorUnits, 2_000_000);
  assert.equal(rent.knownMandatory.initialSubtotal.minorUnits, 4_150_000);
});

test('mandatory quotes and optional quotes retain distinct completeness and known-subtotal behavior', () => {
  const quoted = charge({ amountStatus: 'quote_required', amountMinor: null });
  const mandatory = calculateWirePricingV2(
    kesFromMajor('20000'),
    'rent',
    'month',
    pricing({ declaration: 'complete', charges: [quoted] }),
  );
  assert.equal(mandatory.mandatoryAmountsComplete, false);
  assert.deepEqual(mandatory.unresolvedMandatoryChargeIds, ['service']);
  assert.equal(mandatory.knownMandatory.initialSubtotal.minorUnits, 2_000_000);
  const optional = calculateWirePricingV2(
    kesFromMajor('20000'),
    'rent',
    'month',
    pricing({ declaration: 'complete', charges: [{ ...quoted, mandatory: false }] }),
  );
  assert.equal(optional.mandatoryAmountsComplete, true);
  assert.deepEqual(optional.optionalCosts.quoteRequiredChargeIds, ['service']);
  assert.equal(optional.charges[0].amount, null);
});

test('calculator rejects recurring sale charges, recurring deposits, unsafe sums and invalid base/period using existing rules', () => {
  rejectsDomain(() =>
    calculateWirePricingV2(kesFromMajor('1'), 'sale', null, pricing({ charges: [charge()] })),
  );
  rejectsDomain(() =>
    calculateWirePricingV2(
      kesFromMajor('1'),
      'rent',
      'month',
      pricing({ charges: [charge({ classification: 'refundable_deposit' })] }),
    ),
  );
  rejectsDomain(() =>
    calculateWirePricingV2(
      kesFromMinor(1),
      'rent',
      'month',
      pricing({ charges: [charge({ amountMinor: Number.MAX_SAFE_INTEGER })] }),
    ),
  );
  rejectsDomain(() =>
    calculateWirePricingV2(
      kesFromMinor(1),
      'rent',
      'month',
      pricing({
        charges: [
          charge({ mandatory: false, amountMinor: Number.MAX_SAFE_INTEGER }),
          charge({ id: 'extra', mandatory: false, amountMinor: 1, timing: 'one_off' }),
        ],
      }),
    ),
  );
  rejectsDomain(() => calculateWirePricingV2(kesFromMinor(0), 'rent', 'month', pricing()));
  rejectsDomain(() => calculateWirePricingV2(kesFromMinor(1), 'rent', null, pricing()));
  // Shape validation precedes arithmetic; malformed wire cannot reach a different money error.
  rejectsContract(() => calculateWirePricingV2(kesFromMinor(0), 'rent', null, { charges: [] }));
});

test('canonical pricing and location are detached deeply frozen copies without mutating caller inputs', () => {
  const row = charge();
  const input = pricing({ charges: [row] });
  const sourceLocation = location({ county: 'Nairobi' });
  const canonical = validatePricingInputV2(input);
  const canonicalLocation = validatePublicLocationV2(sourceLocation);
  row.amountMinor = 1;
  input.declaration = 'complete';
  input.charges.length = 0;
  sourceLocation.county = 'Changed';
  assert.equal(canonical.declaration, 'not_declared');
  assert.equal(canonical.charges[0].amountMinor, 100_000);
  assert.equal(canonicalLocation.county, 'Nairobi');
  for (const value of [canonical, canonical.charges, canonical.charges[0], canonicalLocation])
    assert.ok(Object.isFrozen(value));
  assert.throws(() => {
    canonical.charges[0].amountMinor = 2;
  }, TypeError);
  assert.throws(() => canonical.charges.push(charge()), TypeError);
  assert.throws(() => {
    canonicalLocation.area = 'Invented';
  }, TypeError);
  assert.equal(Object.isFrozen(input), false);
});
