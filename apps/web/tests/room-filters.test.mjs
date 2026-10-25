import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomFilters from '../dist/tests/components/RoomFilters.js';
test('room GET controls retain URL values, disclose unknowns and associate only actual field errors', () => {
  const html = renderToStaticMarkup(
    React.createElement(RoomFilters, {
      bedsText: '0',
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
});
