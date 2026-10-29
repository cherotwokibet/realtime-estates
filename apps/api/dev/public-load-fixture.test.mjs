import test from 'node:test';
import assert from 'node:assert/strict';
import { publicLoadStock, journeyFixtureSelection } from './journey-fixtures.mjs';
import { startStaffPreview } from './staff-preview.mjs';

test('fixed representative inventory is distinct, bounded, mixed and explicit', () => {
  const all = ['realtime-estates', 'sample-homes'].map(publicLoadStock);
  assert.equal(new Set(all.flatMap((s) => s.rows.map((r) => r.listingId))).size, 998);
  assert.equal(
    new Set(
      all.flatMap((s) =>
        s.rows.flatMap((r) => [r.operationBase, r.operationBase + 1, r.operationBase + 2]),
      ),
    ).size,
    2994,
  );
  for (const s of all) {
    assert.equal(s.rows.length, 499);
    assert.equal(s.manifest.total, 500);
    assert.equal(s.manifest.saleGenerated, 100);
    assert.ok(s.manifest.monthlyGenerated > 300);
    assert.ok(s.rows.some((r) => r.rentPeriod === 'day'));
    assert.ok(s.rows.some((r) => r.bedrooms === 0));
    assert.ok(s.rows.some((r) => r.bedrooms === 8));
    assert.ok(s.rows.some((r) => r.sharedBathrooms === null));
    assert.ok(Object.isFrozen(s.manifest.listingIds));
  }
  assert.throws(() => publicLoadStock('unknown'));
  assert.equal(journeyFixtureSelection('public-load-v1'), 'public-load-v1');
  assert.throws(() => journeyFixtureSelection('public-load-v1', 'public-search-v1'));
});

test('load fixture refuses production or incomplete reference modes before creating a database', async () => {
  await assert.rejects(
    () => startStaffPreview({ port: 0, journeyFixture: 'public-load-v1' }),
    /compatible public reference/,
  );
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      () => startStaffPreview({ port: 0, journeyFixture: 'public-load-v1' }),
      /production/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
