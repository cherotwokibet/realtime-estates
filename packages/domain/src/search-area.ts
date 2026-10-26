/**
 * Deliberately small GeoJSON Polygon subset for public search areas.
 * Supports one closed WGS84 exterior ring (no holes), with at most 100 edges.
 * Unsupported or malformed polygons are rejected rather than silently widened.
 */
export type SearchAreaPosition = readonly [longitude: number, latitude: number];
export type SearchAreaPolygon = Readonly<{
  type: 'Polygon';
  coordinates: readonly (readonly SearchAreaPosition[])[];
}>;

const MAX_EDGES = 100;
const EPSILON = 1e-10;

function samePosition(a: SearchAreaPosition, b: SearchAreaPosition): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function pointOnSegment(
  point: SearchAreaPosition,
  start: SearchAreaPosition,
  end: SearchAreaPosition,
): boolean {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > EPSILON) return false;
  return (
    x >= Math.min(x1, x2) - EPSILON &&
    x <= Math.max(x1, x2) + EPSILON &&
    y >= Math.min(y1, y2) - EPSILON &&
    y <= Math.max(y1, y2) + EPSILON
  );
}

function orientation(a: SearchAreaPosition, b: SearchAreaPosition, c: SearchAreaPosition): number {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(value) <= EPSILON ? 0 : value > 0 ? 1 : -1;
}

function segmentsIntersect(
  a: SearchAreaPosition,
  b: SearchAreaPosition,
  c: SearchAreaPosition,
  d: SearchAreaPosition,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (
    (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d))
  );
}

/** Parses only a bounded, closed GeoJSON exterior ring without holes. */
export function parseSearchAreaPolygon(value: unknown): SearchAreaPolygon | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const polygon = value as { type?: unknown; coordinates?: unknown };
  if (polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates)) return null;
  if (polygon.coordinates.length !== 1) return null;
  const rawRing = polygon.coordinates[0];
  if (!Array.isArray(rawRing) || rawRing.length < 4 || rawRing.length > MAX_EDGES + 1) return null;

  const ring: SearchAreaPosition[] = [];
  for (const value of rawRing) {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [longitude, latitude] = value;
    if (
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    )
      return null;
    ring.push(Object.freeze([longitude, latitude] as const));
  }

  if (!samePosition(ring[0]!, ring[ring.length - 1]!)) return null;
  const edges = ring.length - 1;
  const uniqueVertices = new Set(
    ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`),
  );
  if (uniqueVertices.size < 3 || uniqueVertices.size !== edges) return null;

  let twiceArea = 0;
  for (let index = 0; index < edges; index += 1) {
    const current = ring[index]!;
    const next = ring[index + 1]!;
    // Avoid ambiguous wraparound interpretation in this first, local-search slice.
    if (Math.abs(next[0] - current[0]) > 180) return null;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  if (Math.abs(twiceArea) <= EPSILON) return null;

  for (let first = 0; first < edges; first += 1) {
    for (let second = first + 1; second < edges; second += 1) {
      if (second === first + 1 || (first === 0 && second === edges - 1)) continue;
      if (segmentsIntersect(ring[first]!, ring[first + 1]!, ring[second]!, ring[second + 1]!))
        return null;
    }
  }

  return Object.freeze({ type: 'Polygon', coordinates: Object.freeze([Object.freeze(ring)]) });
}

/** Includes points on the polygon boundary; coordinates are always [longitude, latitude]. */
export function pointInSearchArea(point: SearchAreaPosition, polygon: SearchAreaPolygon): boolean {
  const [longitude, latitude] = point;
  if (
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  )
    return false;

  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 2; index < ring.length - 1; previous = index++) {
    const current = ring[index]!;
    const prior = ring[previous]!;
    const candidate: SearchAreaPosition = [longitude, latitude];
    if (pointOnSegment(candidate, current, prior)) return true;
    const crossesLatitude = current[1] > latitude !== prior[1] > latitude;
    if (
      crossesLatitude &&
      longitude <
        ((prior[0] - current[0]) * (latitude - current[1])) / (prior[1] - current[1]) + current[0]
    )
      inside = !inside;
  }
  return inside;
}
