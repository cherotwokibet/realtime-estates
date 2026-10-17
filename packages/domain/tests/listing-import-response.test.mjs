import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LISTING_IMPORT_COLUMNS,
  previewListingImport,
  validateListingImportPreview,
} from '../dist/index.js';
const csv =
  LISTING_IMPORT_COLUMNS.join(',') +
  '\n' +
  [
    'new-stock',
    'Synthetic title',
    '',
    'rent',
    'apartment',
    '20000.05',
    'month',
    '1',
    '1',
    '',
    'KE',
    'Synthetic locality',
    'area',
  ].join(',');
const data = () => previewListingImport(csv, [], true);
test('import response is detached frozen recomputation bound to CSV and claimed collision facts', () => {
  const input = JSON.parse(JSON.stringify(data())),
    out = validateListingImportPreview(input, csv);
  input.rows[0].content.title = 'changed';
  assert.equal(out.rows[0].content.amountMinor, 2000005);
  assert.equal(out.rows[0].content.title, 'Synthetic title');
  assert.ok(Object.isFrozen(out.rows[0].content));
  const collision = previewListingImport(csv, ['new-stock'], true);
  assert.deepEqual(validateListingImportPreview(collision, csv), collision);
});
test('import response rejects altered row facts, content, counts, unknown fields and false checked state', () => {
  for (const edit of [
    (p) => p.validRows++,
    (p) => p.rows[0].record++,
    (p) => p.rows[0].content.amountMinor++,
    (p) => (p.rows[0].slug = 'other-stock'),
    (p) => (p.rows[0].content.title = 'forged'),
    (p) => (p.extra = true),
    (p) => (p.existingStockChecked = false),
    (p) => (p.rows = []),
    (p) => p.rows[0].issues.push({ field: 'slug', code: 'INVENTED', message: 'bad' }),
  ]) {
    const p = JSON.parse(JSON.stringify(data()));
    edit(p);
    assert.throws(() => validateListingImportPreview(p, csv));
  }
  const p = JSON.parse(JSON.stringify(previewListingImport(csv, ['new-stock'], true)));
  p.rows[0].slug = 'other-stock';
  assert.throws(() => validateListingImportPreview(p, csv));
});
test('import response rejects accessors, sparse arrays and custom iterators without invoking them', () => {
  let called = 0;
  const p = JSON.parse(JSON.stringify(data()));
  Object.defineProperty(p.rows[0].content, 'title', {
    enumerable: true,
    get() {
      called++;
      return 'Synthetic title';
    },
  });
  assert.throws(() => validateListingImportPreview(p, csv));
  const q = JSON.parse(JSON.stringify(data()));
  q.rows[Symbol.iterator] = function* () {
    called++;
  };
  assert.throws(() => validateListingImportPreview(q, csv));
  const r = JSON.parse(JSON.stringify(data()));
  r.rows = Array(1);
  assert.throws(() => validateListingImportPreview(r, csv));
  assert.equal(called, 0);
});
