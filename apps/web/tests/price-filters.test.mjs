import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PriceFilters from '../dist/tests/components/PriceFilters.js';

test('inclusive price controls retain both exact URL bounds and associate actual range errors', () => {
  const html = renderToStaticMarkup(
    React.createElement(PriceFilters, {
      minText: '20000.01',
      minMode: '',
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
      minMode: '',
      maxText: '',
      errorFields: [],
    }),
  );
  assert.equal((reset.match(/<input[^>]*value=""/g) || []).length, 2);
  assert.match(reset, /<option value="" selected="">At least<\/option>/);
  assert.ok(!reset.includes('aria-invalid'));
});

test('minimum comparison retains explicit Over and unsupported URL choices with useful error association', () => {
  for (const [minMode, label] of [
    ['over', 'Over (excludes equal price)'],
    ['unknown', 'Unsupported comparison: unknown'],
    [' over ', 'Unsupported comparison:  over '],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(PriceFilters, {
        minText: '20000.01',
        minMode,
        maxText: '',
        errorFields: ['minMode'],
      }),
    );
    assert.match(
      html,
      /<select(?=[^>]*name="minMode")(?=[^>]*aria-invalid="true")(?=[^>]*aria-describedby="search-error")[^>]*>/,
    );
    assert.ok(html.includes(`<option value="${minMode}" selected="">${label}</option>`));
    assert.match(html, /<input(?=[^>]*name="min")(?=[^>]*value="20000.01")[^>]*>/);
    assert.equal((html.match(/aria-invalid="true"/g) || []).length, 1);
  }
  const missingMin = renderToStaticMarkup(
    React.createElement(PriceFilters, {
      minText: '',
      minMode: 'over',
      maxText: '',
      errorFields: ['min', 'minMode'],
    }),
  );
  assert.equal((missingMin.match(/aria-invalid="true"/g) || []).length, 2);
  assert.ok(missingMin.includes('<option value="over" selected="">'));
});
