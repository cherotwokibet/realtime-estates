import { parseSearchAreaPolygon, type SearchAreaPolygon } from '@realtor/domain';

export type SearchAreaMapPoint = readonly [longitude: number, latitude: number];
export const OSM_STANDARD_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Only enable the documented, visibly attributed OSM standard raster source in this first slice. */
export function supportedSearchAreaTileUrl(value: string | undefined): string | null {
  return value === OSM_STANDARD_TILE_URL ? value : null;
}

/** Convert editable map vertices into the same strict bounded search polygon accepted by the API. */
export function searchAreaPolygonText(points: readonly SearchAreaMapPoint[]): string | null {
  if (points.length < 3 || points.length > 100) return null;
  const ring = points.map(([longitude, latitude]) => [longitude, latitude]);
  const first = ring[0];
  if (!first) return null;
  ring.push([...first]);
  const polygon = parseSearchAreaPolygon({ type: 'Polygon', coordinates: [ring] });
  return polygon ? JSON.stringify(polygon) : null;
}

export function searchAreaPolygonFromText(value: string): SearchAreaPolygon | null {
  if (!value || value.length > 8192) return null;
  try {
    return parseSearchAreaPolygon(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Return editable vertices for a validated URL/text boundary, excluding its closing duplicate. */
export function searchAreaPolygonVerticesFromText(value: string): [number, number][] | null {
  const polygon = searchAreaPolygonFromText(value);
  if (!polygon) return null;
  return polygon.coordinates[0]!.slice(0, -1).map(([longitude, latitude]) => [longitude, latitude]);
}

/** Validate a point drag before changing editor state; invalid edits leave the caller's points intact. */
export function moveSearchAreaPolygonVertex(
  points: readonly SearchAreaMapPoint[],
  index: number,
  position: SearchAreaMapPoint,
): [number, number][] | null {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) return null;
  const moved = points.map(([longitude, latitude]) => [longitude, latitude] as [number, number]);
  moved[index] = [position[0], position[1]];
  return searchAreaPolygonText(moved) ? moved : null;
}
