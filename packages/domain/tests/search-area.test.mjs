import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSearchAreaPolygon, pointInSearchArea } from '../dist/search-area.js';

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [36.8, -1.3],
      [36.9, -1.3],
      [36.9, -1.2],
      [36.8, -1.2],
      [36.8, -1.3],
    ],
  ],
};

test('parses a bounded, closed WGS84 polygon and freezes normalized coordinates', () => {
  const parsed = parseSearchAreaPolygon(square);
  assert.ok(parsed);
  assert.equal(parsed.type, 'Polygon');
  assert.equal(Object.isFrozen(parsed.coordinates[0]), true);
  assert.equal(pointInSearchArea([36.85, -1.25], parsed), true);
  assert.equal(pointInSearchArea([36.95, -1.25], parsed), false);
});

test('treats points on horizontal, vertical, and vertex boundaries as inside', () => {
  const parsed = parseSearchAreaPolygon(square);
  assert.ok(parsed);
  assert.equal(pointInSearchArea([36.85, -1.3], parsed), true);
  assert.equal(pointInSearchArea([36.8, -1.25], parsed), true);
  assert.equal(pointInSearchArea([36.9, -1.2], parsed), true);
});

test('rejects malformed, unclosed, degenerate, oversized, out-of-range and holed polygons', () => {
  const invalid = [
    null,
    [],
    { type: 'LineString', coordinates: square.coordinates },
    { ...square, coordinates: [] },
    { ...square, coordinates: [square.coordinates[0], square.coordinates[0]] },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 2],
          [0, 2],
          [2, 0],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [1, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [181, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0], ...Array.from({ length: 98 }, () => [0, 0])]],
    },
    {
      type: 'Polygon',
      coordinates: [
        [
          [179, 0],
          [-179, 0],
          [-179, 1],
          [179, 1],
          [179, 0],
        ],
      ],
    },
  ];
  for (const value of invalid) assert.equal(parseSearchAreaPolygon(value), null);
});

test('rejects invalid query points rather than matching them', () => {
  const parsed = parseSearchAreaPolygon(square);
  assert.ok(parsed);
  for (const point of [
    [NaN, 0],
    [181, 0],
    [0, 91],
    [0, -91],
  ]) {
    assert.equal(pointInSearchArea(point, parsed), false);
  }
});
