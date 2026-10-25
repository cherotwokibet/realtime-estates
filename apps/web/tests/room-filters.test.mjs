import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomFilters from '../dist/tests/components/RoomFilters.js';
test('room GET controls retain URL values, disclose unknowns and associate only actual field errors', () => {
  const html = renderToStaticMarkup(
    React.createElement(RoomFilters, {
      bedsText: '0',
      bedsMode: '',
      privateBathsText: '2',
      sharedBathsText: '',
      errorFields: ['privateBaths'],
    }),
  );
  assert.match(html, /name="beds"[^>]*value="0"/);
  assert.match(
    html,
    /<input(?=[^>]*name="privateBaths")(?=[^>]*aria-invalid="true")(?=[^>]*aria-describedby="search-error")(?=[^>]*value="2")[^>]*>/,
  );
  assert.match(html, /name="sharedBaths"[^>]*value=""/);
  assert.equal((html.match(/aria-invalid/g) || []).length, 1);
  assert.ok(html.includes('shared bathrooms do not count as private bathrooms'));
  assert.ok(html.includes('Blank includes unknown counts'));
  assert.match(html, /min="0" max="100" step="1"/);
  assert.ok(html.includes('<option value="" selected="">Exactly</option>'));
  assert.ok(html.includes('including zero, requires a declared value'));
});

test('bedroom controls retain 7+ grouping, every exact count, and invalid comparison correction', () => {
  for (const [bedsText, bedsMode] of [
    ['7', 'at_least'],
    ['7', ''],
    ['8', ''],
    ['9', ''],
    ['10', ''],
    ['0', ''],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(RoomFilters, {
        bedsText,
        bedsMode,
        privateBathsText: '',
        sharedBathsText: '',
        errorFields: [],
      }),
    );
    assert.ok(html.includes(`<option value="${bedsMode}" selected="">`));
    assert.match(html, new RegExp(`<input(?=[^>]*name="beds")(?=[^>]*value="${bedsText}")[^>]*>`));
    assert.ok(html.includes('To include 7+ bedrooms, choose At least and enter 7.'));
    assert.ok(!html.includes('aria-invalid'));
  }
  const invalid = renderToStaticMarkup(
    React.createElement(RoomFilters, {
      bedsText: '7',
      bedsMode: ' at_least ',
      privateBathsText: '',
      sharedBathsText: '',
      errorFields: ['bedsMode'],
    }),
  );
  assert.ok(
    invalid.includes(
      '<option value=" at_least " selected="">Unsupported comparison:  at_least </option>',
    ),
  );
  assert.match(
    invalid,
    /<select(?=[^>]*name="bedsMode")(?=[^>]*aria-invalid="true")(?=[^>]*aria-describedby="search-error")[^>]*>/,
  );
  const missing = renderToStaticMarkup(
    React.createElement(RoomFilters, {
      bedsText: '',
      bedsMode: 'at_least',
      privateBathsText: '',
      sharedBathsText: '',
      errorFields: ['beds', 'bedsMode'],
    }),
  );
  assert.equal((missing.match(/aria-invalid="true"/g) || []).length, 2);
});
