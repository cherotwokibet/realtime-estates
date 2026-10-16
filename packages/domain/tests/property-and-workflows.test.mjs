import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kesFromMajor,
  createListing,
  reviseListing,
  submitListing,
  withdrawListingReview,
  reviewListing,
  publishListing,
  unpublishListing,
  pauseListing,
  archiveListing,
  setListingAvailability,
  isListingPublic,
  availabilityToDatabase,
  availabilityFromDatabase,
  validateListingDraft,
  MAX_LISTING_PRICE_MINOR,
  createEnquiry,
  transitionEnquiry,
  createViewing,
  transitionViewing,
  requireTimestamp,
} from '../dist/index.js';

const at = '2026-10-09T12:00:00Z';
const rules = { minImages: 4, minTitleLength: 5, minDescriptionLength: 20 };
const draft = {
  title: 'Synthetic studio listing',
  description: 'A synthetic property used only in isolated automated tests.',
  propertyType: 'studio',
  purpose: 'rent',
  price: kesFromMajor('25000'),
  rentalPeriod: 'month',
  fees: [],
  bedrooms: 0,
  bathrooms: 1,
  location: { county: 'Synthetic county', town: 'Synthetic town' },
  images: [1, 2, 3, 4].map((number) => ({
    assetId: `synthetic-image-${number}`,
    alt: `Synthetic studio view ${number}`,
  })),
};
const initial = () =>
  createListing({ id: 'synthetic-property', tenantId: 'tenant-a', ownerId: 'agent-owner', draft });
const approve = (listing) =>
  reviewListing(listing, {
    decision: 'approve',
    revision: listing.revision,
    reviewerId: 'admin-reviewer',
    reviewedAt: at,
    auditId: `audit-${listing.revision}`,
  });
const published = () => publishListing(approve(submitListing(initial(), rules)), at);

test('studio zero bedrooms and genuinely unknown coordinates are valid', () => {
  assert.deepEqual(validateListingDraft(draft, rules), []);
  const listing = initial();
  assert.equal(listing.draft.bedrooms, 0);
  assert.equal(listing.draft.location.latitude, undefined);
  assert.equal(isListingPublic(listing), false);
});
test('create/edit use one submission validator for price, photos, rental period and location', () => {
  const invalid = {
    ...draft,
    price: kesFromMajor('0'),
    images: draft.images.slice(0, 3),
    rentalPeriod: null,
    location: { ...draft.location, latitude: -1 },
  };
  const fields = validateListingDraft(invalid, rules).map((issue) => issue.field);
  for (const field of ['price', 'images', 'rentalPeriod', 'location.coordinates'])
    assert.ok(fields.includes(field), field);
  assert.throws(() =>
    submitListing(
      createListing({
        id: 'invalid',
        tenantId: 'tenant-a',
        ownerId: 'agent-owner',
        draft: invalid,
      }),
      rules,
    ),
  );
  const changed = reviseListing(published(), invalid);
  assert.throws(() => submitListing(changed, rules));
  assert.equal(changed.publishedSnapshot.revision, 1);
});
test('sale omits rental period, images need stable unique IDs, and prices respect the declared ceiling', () => {
  assert.deepEqual(
    validateListingDraft({ ...draft, purpose: 'sale', rentalPeriod: null }, rules),
    [],
  );
  assert.ok(
    validateListingDraft({ ...draft, purpose: 'sale' }, rules).some(
      (issue) => issue.field === 'rentalPeriod',
    ),
  );
  assert.ok(
    validateListingDraft(
      { ...draft, images: [draft.images[0], draft.images[0], ...draft.images.slice(2)] },
      rules,
    ).some((issue) => issue.code === 'INVALID_IMAGE'),
  );
  assert.ok(
    validateListingDraft(
      { ...draft, price: { currency: 'KES', minorUnits: MAX_LISTING_PRICE_MINOR + 1 } },
      rules,
    ).some((issue) => issue.field === 'price'),
  );
  assert.deepEqual(
    validateListingDraft(
      { ...draft, price: { currency: 'KES', minorUnits: MAX_LISTING_PRICE_MINOR } },
      rules,
    ),
    [],
  );
});
test('a draft cannot publish directly; pending revision cannot be silently changed or reviewed stale', () => {
  const listing = initial();
  assert.throws(
    () => publishListing(listing, at),
    (error) => error.code === 'APPROVAL_REQUIRED',
  );
  const pending = submitListing(listing, rules);
  assert.throws(
    () => reviseListing(pending, { ...draft, title: 'Changed during review' }),
    (error) => error.code === 'REVIEW_PENDING',
  );
  assert.throws(
    () =>
      reviewListing(pending, {
        decision: 'approve',
        revision: 2,
        reviewerId: 'admin',
        reviewedAt: at,
        auditId: 'audit',
      }),
    (error) => error.code === 'STALE_REVIEW',
  );
  assert.throws(
    () => submitListing(pending, rules),
    (error) => error.code === 'INVALID_TRANSITION',
  );
  assert.equal(withdrawListingReview(pending).moderationStatus, 'draft');
});
test('published approved data survives draft changes, review requests and rejected revisions', () => {
  const current = published();
  const edited = reviseListing(current, {
    ...draft,
    title: 'Unreviewed revised title',
    price: kesFromMajor('35000'),
  });
  const pending = submitListing(edited, rules);
  for (const listing of [
    edited,
    pending,
    reviewListing(pending, {
      decision: 'reject',
      revision: 2,
      reviewerId: 'admin',
      reviewedAt: at,
      auditId: 'audit-2',
      reason: 'Synthetic revision needs correction.',
    }),
  ]) {
    assert.equal(isListingPublic(listing), true);
    assert.equal(listing.publishedSnapshot.data.title, 'Synthetic studio listing');
    assert.equal(listing.publishedSnapshot.data.price.minorUnits, 2_500_000);
    assert.equal(listing.publishedSnapshot.revision, 1);
  }
  const accepted = approve(pending);
  assert.equal(accepted.approvedSnapshot.revision, 2);
  assert.equal(accepted.publishedSnapshot.revision, 1);
  const replacement = publishListing(accepted, '2026-10-10T09:00:00+03:00');
  assert.equal(replacement.publishedSnapshot.revision, 2);
  assert.equal(replacement.publishedSnapshot.data.price.minorUnits, 3_500_000);
  assert.equal(current.publishedSnapshot.revision, 1);
});
test('changes requested/rejection require reason; self-approval requires explicit audited acknowledgement', () => {
  const pending = submitListing(initial(), rules);
  assert.throws(() =>
    reviewListing(pending, {
      decision: 'request-changes',
      revision: 1,
      reviewerId: 'admin',
      reviewedAt: at,
      auditId: 'audit',
    }),
  );
  assert.throws(
    () =>
      reviewListing(pending, {
        decision: 'approve',
        revision: 1,
        reviewerId: 'agent-owner',
        reviewedAt: at,
        auditId: 'audit',
      }),
    (error) => error.code === 'SELF_APPROVAL_REQUIRES_ACKNOWLEDGEMENT',
  );
  const accepted = reviewListing(pending, {
    decision: 'approve',
    revision: 1,
    reviewerId: 'agent-owner',
    reviewedAt: at,
    auditId: 'audit-self',
    selfApprovalAcknowledged: true,
  });
  assert.equal(accepted.approvedSnapshot.auditId, 'audit-self');
  assert.throws(() =>
    reviewListing(pending, {
      decision: 'approve',
      revision: 1,
      reviewerId: 'admin',
      reviewedAt: at,
      auditId: '',
    }),
  );
});
test('availability is independent of approval; withdrawn/unpublished/archived do not appear publicly', () => {
  const current = published();
  const reserved = setListingAvailability(current, 'reserved');
  assert.equal(reserved.moderationStatus, 'approved');
  assert.equal(isListingPublic(reserved), false);
  assert.equal(isListingPublic(setListingAvailability(current, 'let')), false);
  assert.equal(isListingPublic(setListingAvailability(current, 'withdrawn')), false);
  assert.equal(isListingPublic(unpublishListing(current)), false);
  assert.equal(isListingPublic(pauseListing(current)), false);
  assert.equal(isListingPublic(archiveListing(current)), false);
  assert.throws(
    () => setListingAvailability(current, 'sold'),
    (error) => error.code === 'INVALID_AVAILABILITY',
  );
  assert.throws(
    () => reviseListing(archiveListing(current), draft),
    (error) => error.code === 'ARCHIVED_LISTING',
  );
});
test('domain and persistence availability enums use an explicit lossless adapter', () => {
  assert.equal(availabilityToDatabase('let'), 'rented');
  assert.equal(availabilityFromDatabase('rented'), 'let');
  for (const value of ['available', 'reserved', 'sold', 'withdrawn'])
    assert.equal(availabilityFromDatabase(availabilityToDatabase(value)), value);
  assert.throws(() => availabilityToDatabase('rented'));
  assert.throws(() => availabilityFromDatabase('let'));
});
test('purpose revisions cannot label old published rental data sold or new sale data let', () => {
  const current = setListingAvailability(published(), 'let');
  const changed = reviseListing(current, { ...draft, purpose: 'sale', rentalPeriod: null });
  assert.throws(
    () => setListingAvailability(changed, 'sold'),
    (error) => error.code === 'INVALID_AVAILABILITY',
  );
  const accepted = approve(submitListing(changed, rules));
  assert.throws(
    () => publishListing(accepted, at),
    (error) => error.code === 'INVALID_AVAILABILITY',
  );
  const sale = publishListing(setListingAvailability(accepted, 'available'), at);
  assert.equal(setListingAvailability(sale, 'sold').availability, 'sold');
});
test('listing snapshots do not share mutable draft input', () => {
  const input = structuredClone(draft);
  const listing = createListing({
    id: 'synthetic',
    tenantId: 'tenant-a',
    ownerId: 'agent-owner',
    draft: input,
  });
  input.images[0].alt = 'Mutated input';
  input.location.town = 'Changed input';
  assert.equal(listing.draft.images[0].alt, 'Synthetic studio view 1');
  assert.equal(listing.draft.location.town, 'Synthetic town');
  assert.throws(() => {
    listing.draft.images[0].alt = 'Mutation';
  }, TypeError);
});
test('enquiry lifecycle records attributable changes and refuses skips or reopening terminal outcomes', () => {
  const enquiry = createEnquiry({
    id: 'synthetic-enquiry',
    tenantId: 'tenant-a',
    propertyId: 'synthetic-property',
  });
  const change = { actorId: 'agent-owner', at };
  assert.throws(
    () => transitionEnquiry(enquiry, 'won', change),
    (error) => error.code === 'INVALID_TRANSITION',
  );
  const contacted = transitionEnquiry(enquiry, 'contacted', change);
  const qualified = transitionEnquiry(contacted, 'qualified', change);
  const won = transitionEnquiry(qualified, 'won', change);
  assert.equal(won.events.length, 3);
  assert.equal(won.events[0].actorId, 'agent-owner');
  assert.equal(enquiry.events.length, 0);
  assert.throws(() => transitionEnquiry(won, 'new', change));
  assert.throws(() => transitionEnquiry(enquiry, 'lost', change));
  assert.equal(
    transitionEnquiry(enquiry, 'lost', {
      ...change,
      reason: 'Synthetic prospect chose another property.',
    }).status,
    'lost',
  );
});
test('viewing is a request until confirmed; terminal statuses cannot be rewritten', () => {
  const viewing = createViewing({
    id: 'synthetic-viewing',
    tenantId: 'tenant-a',
    enquiryId: 'synthetic-enquiry',
    startsAt: '2026-10-10T09:00:00+03:00',
  });
  const change = { actorId: 'agent-owner', at: '2026-10-10T10:00:00+03:00' };
  assert.equal(viewing.startsAt, '2026-10-10T06:00:00.000Z');
  assert.throws(() => transitionViewing(viewing, 'completed', change));
  const confirmed = transitionViewing(viewing, 'confirmed', change);
  const completed = transitionViewing(confirmed, 'completed', change);
  assert.equal(completed.status, 'completed');
  assert.throws(() => transitionViewing(completed, 'confirmed', change));
  assert.throws(() => transitionViewing(viewing, 'cancelled', change));
  assert.equal(
    transitionViewing(viewing, 'cancelled', {
      ...change,
      reason: 'Synthetic customer cancellation.',
    }).status,
    'cancelled',
  );
});
test('workflow timestamps require real calendar values and explicit timezone', () => {
  for (const value of [
    '2026-10-09T12:00:00',
    '2026-02-30T12:00:00Z',
    '2026-10-09T24:00:00Z',
    'invalid',
  ])
    assert.throws(() => requireTimestamp(value));
  assert.equal(requireTimestamp('2024-02-29T09:00:00+03:00'), '2024-02-29T06:00:00.000Z');
});
