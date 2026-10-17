import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReviewMediaGallery } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  L = id(3);
const gallery = () => ({
  kind: 'review_media_gallery',
  listingId: L,
  revision: 12,
  version: '7',
  state: 'pending',
  photos: Array.from({ length: 4 }, (_, position) => ({
    id: id(100 + position),
    alt: 'Synthetic',
    position,
  })),
});
test('review gallery preserves 300 Unicode scalar descriptions in a detached deeply frozen snapshot', () => {
  const input = gallery();
  input.photos[0].alt = '🏡'.repeat(300);
  const g = validateReviewMediaGallery(input, L, 12, '7');
  input.photos[0].alt = 'changed';
  assert.equal(g.photos[0].alt, '🏡'.repeat(300));
  assert.ok(Object.isFrozen(g.photos[0]) && Object.isFrozen(g.photos) && Object.isFrozen(g));
  for (const alt of ['🏡'.repeat(301), '\ud800', 'private\u0000text'])
    assert.throws(() =>
      validateReviewMediaGallery(
        { ...gallery(), photos: gallery().photos.map((p) => ({ ...p, alt })) },
        L,
        12,
        '7',
      ),
    );
});
test('review gallery refuses accessor and sparse array authority without reading getter values', () => {
  let invoked = 0;
  const input = gallery();
  Object.defineProperty(input.photos[0], 'id', {
    get() {
      invoked++;
      return id(1);
    },
    enumerable: true,
  });
  assert.throws(() => validateReviewMediaGallery(input, L, 12, '7'));
  assert.equal(invoked, 0);
  const sparse = gallery();
  delete sparse.photos[1];
  assert.throws(() => validateReviewMediaGallery(sparse, L, 12, '7'));
});
