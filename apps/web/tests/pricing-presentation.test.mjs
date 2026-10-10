import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePricingDisclosure, kesFromMajor } from '@realtor/domain';
import { getPricingPresentation } from '../dist/tests/components/pricing-presentation.js';

const charge = (id, amount, overrides = {}) => ({
  id, name: `Named ${id}`, amountStatus: 'known', amount: kesFromMajor(amount),
  timing: 'one_off', classification: 'fee', mandatory: true, ...overrides,
});
const rent = (overrides = {}) => calculatePricingDisclosure({
  base: kesFromMajor('20000'), purpose: 'rent', rentalPeriod: 'month', charges: [], ...overrides,
});

test('pricing presentation formats exact KES subtotals and retains the actual rental period', () => {
  const view = getPricingPresentation(rent({ rentalPeriod: 'week', disclosure: 'complete', charges: [
    charge('service', '1000.01', { timing: 'per_rental_period' }),
    charge('deposit', '20000', { classification: 'refundable_deposit' }),
    charge('setup', '500'),
  ] }));
  assert.equal(view.baseAmount, 'KES 20,000');
  assert.equal(view.period, 'week');
  assert.equal(view.knownRecurringSubtotal, 'KES 21,000.01');
  assert.equal(view.knownRefundableDeposit, 'KES 20,000');
  assert.equal(view.knownInitialSubtotal, 'KES 41,500.01');
  assert.equal(view.mandatoryCharges[0].timing, 'Per week');
  assert.equal(view.mandatoryCharges[1].classification, 'Refundable deposit');
  assert.match(view.initialNote, /first week/);
  assert.equal(view.status.title, 'Declared mandatory amounts supplied');
  assert.match(view.status.detail, /Confirm/);
});

test('undeclared empty fees show none supplied and incomplete disclosure rather than claiming zero fees', () => {
  const view = getPricingPresentation(rent());
  assert.equal(view.knownRecurringFees, 'None supplied');
  assert.equal(view.knownOneOffFees, 'None supplied');
  assert.equal(view.knownRefundableDeposit, 'None supplied');
  assert.equal(view.status.kind, 'incomplete');
  assert.equal(view.status.title, 'Cost disclosure not supplied');
  assert.match(view.status.detail, /further costs may apply/);
  assert.equal(view.knownInitialSubtotal, 'KES 20,000');
  assert.deepEqual(view.mandatoryCharges, []);
});

test('mandatory quote-required charges retain names and never receive invented zero amounts', () => {
  const view = getPricingPresentation(rent({ disclosure: 'complete', charges: [
    { id: 'quote', name: 'Lease preparation', amountStatus: 'quote_required', amount: null, mandatory: true, classification: 'fee', timing: 'one_off' },
  ] }));
  assert.equal(view.status.title, 'Mandatory amounts to confirm');
  assert.equal(view.status.kind, 'incomplete');
  assert.deepEqual(view.mandatoryQuoteNames, ['Lease preparation']);
  assert.equal(view.mandatoryCharges[0].amount, 'Amount to confirm');
  assert.equal(view.mandatoryCharges[0].quoteRequired, true);
  assert.equal(view.knownInitialSubtotal, 'KES 20,000');
});

test('optional amounts and optional quotes stay separate from mandatory completeness and initial subtotal', () => {
  const view = getPricingPresentation(rent({ disclosure: 'complete', charges: [
    charge('optional-known', '500', { mandatory: false }),
    { id: 'optional-quote', name: 'Optional cleaning', amountStatus: 'quote_required', amount: null, mandatory: false, classification: 'fee', timing: 'one_off' },
  ] }));
  assert.equal(view.status.kind, 'complete');
  assert.equal(view.knownInitialSubtotal, 'KES 20,000');
  assert.equal(view.optionalKnownInitialExtras, 'KES 500');
  assert.deepEqual(view.mandatoryCharges, []);
  assert.deepEqual(view.mandatoryQuoteNames, []);
  assert.equal(view.optionalCharges[1].name, 'Optional cleaning');
  assert.equal(view.optionalCharges[1].amount, 'Amount to confirm');
  assert.match(view.optionalExtrasNote, /if chosen/);
});

test('incomplete and explicitly complete empty declarations retain different disclosure copy', () => {
  const incomplete = getPricingPresentation(rent({ disclosure: 'incomplete' }));
  assert.equal(incomplete.status.title, 'Cost disclosure incomplete');
  const complete = getPricingPresentation(rent({ disclosure: 'complete' }));
  assert.equal(complete.status.title, 'Declared mandatory amounts supplied');
  assert.match(complete.status.detail, /taxes or third-party costs/);
  assert.equal(complete.knownOneOffFees, 'None supplied');
});

test('sale presentation has no invented rental period or recurring price', () => {
  const view = getPricingPresentation(calculatePricingDisclosure({
    base: kesFromMajor('999999'), purpose: 'sale', rentalPeriod: null, disclosure: 'complete',
    charges: [charge('sale-fee', '1500')],
  }));
  assert.equal(view.baseLabel, 'Sale price');
  assert.equal(view.period, null);
  assert.equal(view.knownRecurringSubtotal, null);
  assert.equal(view.knownInitialSubtotal, 'KES 1,001,499');
  assert.match(view.initialNote, /^Sale price/);
  assert.equal(view.optionalExtrasLabel, 'Known optional one-off extras');
});

test('presentation data is frozen and shares no mutable charge rows with callers', () => {
  const pricing = rent({ charges: [charge('service', '1000')] });
  const view = getPricingPresentation(pricing);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.status));
  assert.ok(Object.isFrozen(view.mandatoryCharges));
  assert.ok(Object.isFrozen(view.mandatoryCharges[0]));
  assert.notEqual(view.mandatoryCharges[0], pricing.charges[0]);
  assert.throws(() => { view.mandatoryCharges[0].amount = 'KES 0'; }, TypeError);
});
