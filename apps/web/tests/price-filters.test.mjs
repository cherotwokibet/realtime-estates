import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PriceFilters from '../dist/tests/components/PriceFilters.js';

test('inclusive price controls retain both exact URL bounds and associate actual range errors', () => {
  const html = renderToStaticMarkup(
    React.createElement(PriceFilters, {
      minText: '20000.01',
      maxText: '20000.00',
      errorFields: ['min', 'max'],
    }),
  );
  for (const [name, value] of [
    ['min', '20000.01'],
    ['max', '20000.00'],
  ]) {
    assert.match(
      html,
      new RegExp(
        `<input(?=[^>]*name="${name}")(?=[^>]*value="${value}")(?=[^>]*aria-invalid="true")(?=[^>]*aria-describedby="search-error")[^>]*>`,
      ),
    );
  }
  assert.ok(html.includes('Minimum base price (KES)'));
  assert.ok(html.includes('Maximum base price (KES)'));
  assert.equal((html.match(/min="0.01" step="0.01"/g) || []).length, 2);
  const reset = renderToStaticMarkup(
    React.createElement(PriceFilters, {
      minText: '',
      maxText: '',
      errorFields: [],
    }),
  );
  assert.equal((reset.match(/value=""/g) || []).length, 2);
  assert.ok(!reset.includes('aria-invalid'));
});
