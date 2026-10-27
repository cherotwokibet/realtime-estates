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
