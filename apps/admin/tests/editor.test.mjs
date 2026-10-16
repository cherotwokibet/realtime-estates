import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftToForm,
  formToDraft,
  parseMoney,
  reconcileDraft,
} from '../dist/tests/lib/editor-model.js';
import { validateStaffDraftContentV2 } from '@realtor/api-client';
const content = validateStaffDraftContentV2({
  title: 'Synthetic studio',
  description: 'Synthetic description',
  purpose: 'rent',
  propertyType: 'studio',
  amountMinor: 2000001,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: 0,
  locality: 'Synthetic area',
  privateAddress: 'Synthetic private address',
  publicPrecision: 'exact',
  latitude: -1.2,
  longitude: 36.8,
  pricing: {
    declaration: 'complete',
    charges: [
      {
        id: 'service',
        name: 'Service fee',
        amountStatus: 'known',
        amountMinor: 100001,
        timing: 'per_rental_period',
        classification: 'fee',
        mandatory: true,
      },
      {
        id: 'quote',
        name: 'Optional quote',
        amountStatus: 'quote_required',
        amountMinor: null,
        timing: 'one_off',
        classification: 'fee',
        mandatory: false,
      },
    ],
  },
  location: { county: 'Nairobi', town: null, area: 'Synthetic area' },
});
const baseline = { revision: 1, state: 'draft', version: '2', content };
test('KES input preserves cents with integer arithmetic and rejects lossy notation', () => {
  assert.equal(parseMoney('20000.01'), 2000001);
  assert.equal(parseMoney('0.01'), 1);
  assert.equal(parseMoney('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(parseMoney(''), null);
  for (const text of ['1e2', '1.001', '0', '-1', '+1', '1,000', '90071992547409.92'])
    assert.throws(() => parseMoney(text));
});
test('full form roundtrip retains unedited private data, exact coordinates, quote null and charge IDs', () => {
  assert.deepEqual(formToDraft(draftToForm(content)), content);
  const multiline = { ...content, privateAddress: '  Synthetic address\nSecond line  ' };
  assert.deepEqual(formToDraft(draftToForm(multiline)), multiline);
  const form = draftToForm(content);
  form.title = 'Edited synthetic title';
  assert.deepEqual(formToDraft(form), { ...content, title: form.title });
});
test('blank location stays unknown and incomplete drafts can be saved without fabricated defaults', () => {
  const incomplete = validateStaffDraftContentV2({
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
  });
  assert.deepEqual(formToDraft(draftToForm(incomplete)), incomplete);
});
test('valid small coordinate values roundtrip without changing money notation rules', () => {
  const small = { ...content, latitude: 1e-7, longitude: -1e-7 };
  assert.deepEqual(formToDraft(draftToForm(small)), small);
  assert.throws(() => parseMoney('1e-7'));
});
test('uncertain write matching the readback is reconciled; a different version keeps local edits', () => {
  const local = draftToForm(content);
  local.title = 'My local edit';
  assert.equal(reconcileDraft(baseline, local, baseline), 'unchanged');
  const saved = { ...baseline, version: '3', content: formToDraft(local) };
  assert.equal(reconcileDraft(baseline, local, saved), 'saved');
  assert.equal(
    reconcileDraft(baseline, local, {
      ...saved,
      content: { ...content, title: 'Other agent edit' },
    }),
    'conflict',
  );
  assert.equal(local.title, 'My local edit');
  assert.equal(baseline.version, '2');
});
test('invalid local input and state-only changes remain recoverable and never silently become a new baseline', () => {
  const form = draftToForm(content);
  form.amount = '1e2';
  assert.equal(reconcileDraft(baseline, form, baseline), 'unchanged');
  assert.equal(reconcileDraft(baseline, form, { ...baseline, state: 'pending' }), 'conflict');
  assert.equal(form.amount, '1e2');
});
