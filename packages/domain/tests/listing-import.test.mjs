import test from 'node:test';
import assert from 'node:assert/strict';
import { LISTING_IMPORT_COLUMNS, previewListingImport } from '../dist/index.js';
const base = [
  'synthetic-flat',
  'Synthetic apartment',
  'A synthetic description',
  'rent',
  'apartment',
  '20000.05',
  'month',
  '2',
  '1',
  '',
  'KE',
  'Synthetic Nairobi',
  'area',
];
const quote = (x) => `"${String(x).replaceAll('"', '""')}"`;
const csv = (rows = [base], columns = LISTING_IMPORT_COLUMNS) =>
  columns.join(',') + '\r\n' + rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
test('CSV preview preserves exact decimal money Unicode quotes and multiline descriptions without inventing charges or private fields', () => {
  const row = [...base];
  row[1] = 'Synthetic 🏡';
  row[2] = 'Quoted "room", first line\nsecond line';
  const result = previewListingImport('\ufeff' + csv([row]));
  assert.equal(result.validRows, 1);
  assert.equal(result.existingStockChecked, false);
  const value = result.rows[0];
  assert.equal(value.content.amountMinor, 2000005);
  assert.equal(value.content.description, row[2]);
  assert.equal(value.content.privateAddress, null);
  assert.deepEqual(value.content.pricing, { declaration: 'not_declared', charges: [] });
  assert.deepEqual(value.content.location, { county: null, town: null, area: null });
  assert.ok(Object.isFrozen(result.rows) && Object.isFrozen(value.content));
});
test('all repeated slugs are row errors and only authorized current-stock matches affect the preview', () => {
  const other = [...base];
  other[0] = 'other-flat';
  const result = previewListingImport(csv([base, base, other]), ['other-flat'], true);
  assert.equal(result.validRows, 0);
  assert.equal(result.invalidRows, 3);
  assert.deepEqual(
    result.rows.map((r) => r.issues[0].code),
    ['DUPLICATE_IN_FILE', 'DUPLICATE_IN_FILE', 'EXISTING_SLUG'],
  );
  assert.ok(result.rows.every((r) => r.content === null));
  assert.throws(() => previewListingImport(csv(), ['other-flat'], false));
});
test('bad money integer and shared draft rules produce bounded row errors while valid neighbors survive', () => {
  const bad = [...base];
  bad[0] = 'bad-flat';
  bad[5] = '2e4';
  bad[7] = '2.5';
  const wrong = [...base];
  wrong[0] = 'wrong-flat';
  wrong[3] = 'sale';
  const result = previewListingImport(csv([base, bad, wrong]));
  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 2);
  assert.ok(result.rows[1].issues.some((i) => i.field === 'priceKes'));
  assert.ok(result.rows[1].issues.some((i) => i.field === 'bedrooms'));
  assert.equal(result.rows[2].issues[0].code, 'INVALID_DRAFT');
});
test('malformed CSV headers quoting separators and global bounds fail without guessing or partial results', () => {
  for (const text of [
    '',
    LISTING_IMPORT_COLUMNS.join(','),
    csv().replace('"synthetic-flat"', '"synthetic-flat"x'),
    csv().slice(0, -3),
    csv().replaceAll('\r\n', '\r'),
    csv().replace('slug,', 'tenantId,'),
    csv().replace('title,', 'slug,'),
    'x'.repeat(32769),
    csv().replace('Synthetic apartment', '\ud800'),
  ])
    assert.throws(() => previewListingImport(text));
});
test('missing columns are per-record errors, reordered exact headers work and source records stay stable', () => {
  const columns = [...LISTING_IMPORT_COLUMNS].reverse(),
    row = [...base].reverse();
  const result = previewListingImport(csv([row, row.slice(1), [...row, 'extra']], columns));
  assert.equal(result.rows[0].record, 2);
  assert.equal(result.rows[1].record, 3);
  assert.equal(result.rows[0].content.amountMinor, 2000005);
  assert.equal(result.rows[1].issues[0].code, 'COLUMN_COUNT');
  assert.equal(result.rows[2].issues[0].code, 'COLUMN_COUNT');
});

test('existing-stock comparison rejects sparse accessor and custom iterator arrays without invoking values', () => {
  let invoked = 0;
  const accessor = ['other-flat'];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() {
      invoked++;
      return 'other-flat';
    },
  });
  const sparse = new Array(1),
    iterator = ['other-flat'];
  iterator[Symbol.iterator] = function* () {
    invoked++;
    while (true) yield 'other-flat';
  };
  for (const values of [accessor, sparse, iterator])
    assert.throws(() => previewListingImport(csv(), values, true));
  assert.equal(invoked, 0);
});
test('preview has a hard100-record cap and unknown draft fields remain explicitly null', () => {
  const rows = Array.from({ length: 100 }, (_, n) => {
    const row = [...base];
    row[0] = 'flat-' + n;
    return row;
  });
  assert.equal(previewListingImport(csv(rows)).rows.length, 100);
  assert.throws(() => previewListingImport(csv([...rows, base])));
  const unknown = [...base];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]) unknown[n] = '';
  const result = previewListingImport(csv([unknown]));
  assert.equal(result.validRows, 1);
  assert.equal(result.rows[0].content.amountMinor, null);
  assert.equal(result.rows[0].content.bedrooms, null);
});
