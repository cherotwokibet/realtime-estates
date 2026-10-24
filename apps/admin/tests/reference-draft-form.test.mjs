import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { ApiClientError } from '@realtor/api-client';
import { draftToForm } from '../dist/tests/lib/editor-model.js';
import { referenceFormCommand } from '../dist/tests/lib/reference-draft-form.js';
import {
  prepareReferenceDraftAttempt,
  restoreReferenceDraftAttempt,
  referenceDraftSession,
} from '../dist/tests/lib/reference-draft-workspace.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogue = {
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [{ id: id(200), kind: 'county', parentId: null, label: 'Synthetic county' }],
  amenities: [
    { id: id(210), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['apartment'] },
  ],
};
const selection = {
  catalogueVersion: '1',
  location: { countyId: id(200), localityId: null, neighbourhoodId: null },
  amenityIds: [id(210)],
};
const target = { operationId: id(300), listingId: id(100), revision: 1, expectedVersion: '2' };
const form = () =>
  draftToForm(
    normalizeStaffDraftContentV2({
      propertyType: 'apartment',
      location: { county: 'Legacy unmatched label', town: null, area: null },
      pricing: { declaration: 'not_declared', charges: [] },
    }),
  );
test('one original combines changed property facts, exact costs, private precision and explicit IDs', () => {
  const f = {
    ...form(),
    title: 'Synthetic new title',
    description: 'Updated facts',
    purpose: 'rent',
    amount: '12345.67',
    rentPeriod: 'month',
    bedrooms: '2',
    privateBathrooms: '1',
    sharedBathrooms: '0',
    privateAddress: 'Synthetic staff-only address',
    latitude: '-1.28',
    longitude: '36.82',
    publicPrecision: 'area',
    declaration: 'incomplete',
    charges: [
      {
        id: id(400),
        name: 'Deposit',
        amountStatus: 'known',
        amount: '987.65',
        timing: 'one_off',
        classification: 'refundable_deposit',
        mandatory: true,
      },
      {
        id: id(401),
        name: 'Service',
        amountStatus: 'quote_required',
        amount: '99.99',
        timing: 'per_rental_period',
        classification: 'fee',
        mandatory: false,
      },
    ],
  };
  const c = referenceFormCommand(f, selection, catalogue, target);
  assert.equal(c.content.title, f.title);
  assert.equal(c.content.description, f.description);
  assert.equal(c.content.amountMinor, 1234567);
  assert.equal(c.content.bedrooms, 2);
  assert.equal(c.content.sharedBathrooms, 0);
  assert.equal(c.content.privateAddress, f.privateAddress);
  assert.equal(c.content.latitude, -1.28);
  assert.equal(c.content.longitude, 36.82);
  assert.equal(c.content.publicPrecision, 'area');
  assert.equal(c.content.pricing.charges[0].amountMinor, 98765);
  assert.equal(c.content.pricing.charges[1].amountMinor, null);
  assert.equal(c.content.pricing.charges[0].classification, 'refundable_deposit');
  assert.equal(c.content.pricing.declaration, 'incomplete');
  assert.equal(c.content.location.county, 'Synthetic county');
  assert.equal(c.content.locality, 'Synthetic county');
  assert.deepEqual(c.selection, selection);
  assert.ok(Object.isFrozen(c));
});
test('explicit unknown selection clears legacy labels without inferring IDs and preserves unknown costs', () => {
  const c = referenceFormCommand(
    form(),
    {
      ...selection,
      location: { countyId: null, localityId: null, neighbourhoodId: null },
      amenityIds: [],
    },
    catalogue,
    target,
  );
  assert.deepEqual(c.content.location, { county: null, town: null, area: null });
  assert.equal(c.content.locality, null);
  assert.equal(c.content.amountMinor, null);
  assert.equal(c.content.pricing.declaration, 'not_declared');
});
test('changed property type requires explicit removal of incompatible amenities', () => {
  const f = { ...form(), propertyType: 'land' };
  assert.throws(() => referenceFormCommand(f, selection, catalogue, target));
  assert.equal(
    referenceFormCommand(f, { ...selection, amenityIds: [] }, catalogue, target).content
      .propertyType,
    'land',
  );
});
test('invalid fractional money, room count, coordinates and sale period cannot become reviewed originals', () => {
  for (const patch of [
    { amount: '1e4' },
    { amount: '0.001' },
    { bedrooms: '2.5' },
    { latitude: '-1' },
    { publicPrecision: 'approximate' },
    { purpose: 'sale', rentPeriod: 'month' },
  ])
    assert.throws(() =>
      referenceFormCommand({ ...form(), ...patch }, selection, catalogue, target),
    );
});
test('review is write-free; storage restoration retains full original and historical catalogue', async () => {
  const store = new Map(),
    storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    scope = { instanceId: id(9), tenantId: id(1), actorId: id(10), listingId: id(100) },
    session = referenceDraftSession(storage, scope),
    calls = [];
  const client = {
    catalogue: async (version) => {
      calls.push(['catalogue', version]);
      return catalogue;
    },
    create: async (c) => {
      calls.push(['POST', c]);
      throw new ApiClientError('NETWORK', 'Synthetic reply lost', { submissionUncertain: true });
    },
    recover: async (c) => {
      calls.push(['GET', c]);
      throw new ApiClientError('NETWORK', 'Synthetic GET unavailable');
    },
  };
  const c = referenceFormCommand(
      { ...form(), title: 'Frozen review', amount: '123.45' },
      selection,
      catalogue,
      target,
    ),
    attempt = prepareReferenceDraftAttempt(client, session, c, catalogue);
  assert.equal(store.size, 0);
  assert.equal(calls.length, 0);
  assert.equal(attempt.original.content.amountMinor, 12345);
  assert.ok(Object.isFrozen(attempt.catalogue));
  await assert.rejects(attempt.submit());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(store.size, 1);
  const restored = await restoreReferenceDraftAttempt(client, session);
  assert.deepEqual(restored.original, c);
  assert.deepEqual(restored.catalogue, catalogue);
  assert.equal(restored.status, 'uncertain');
  await assert.rejects(restored.recoverOriginal());
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['POST', 'catalogue', 'GET'],
  );
  assert.equal(store.size, 1);
});
