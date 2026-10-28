import type { CatalogueFilters } from '../lib/catalogue.ts';
import { loadedPageHref } from '../lib/catalogue-browse.ts';
import SearchAreaMapEditor from './SearchAreaMapEditor.tsx';

/** Accessible keyboard path for supplying the same bounded polygon contract used by area search. */
export default function SearchAreaField({
  supported,
  invalid,
  value,
  filters,
  sort,
  tileUrl,
  syntheticGrid = false,
}: {
  supported: boolean;
  invalid: boolean;
  value: string;
  filters: CatalogueFilters;
  sort: string;
  tileUrl: string | null;
  syntheticGrid?: boolean;
}) {
  if (!supported) return null;
  // When the area itself is the validation error, clear just that value while
  // keeping the already-validated filters. Other validation errors stay closed.
  const canClearArea = value.length > 0 && (!filters.error || invalid);
  const clearFilters = { ...filters, area: null, error: null };
  return (
    <fieldset className="reference-filters search-area-field">
      <legend>Search within a polygon area</legend>
      <p id="search-area-help" className="search-help">
        Paste or edit a GeoJSON Polygon with one closed WGS84 longitude, latitude ring and no holes.
        The search accepts up to 100 edges and matches only listings with approved public
        coordinates. Enter or edit GeoJSON by keyboard, or draw an approximate boundary on the map
        when an approved map source is configured.
      </p>
      <label className="search-field" htmlFor="search-area-polygon">
        <span>Area polygon (GeoJSON)</span>
        <textarea
          id="search-area-polygon"
          name="area"
          rows={5}
          maxLength={8192}
          defaultValue={value}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'search-area-help search-error' : 'search-area-help'}
          placeholder='{"type":"Polygon","coordinates":[[[36.8,-1.3],[36.9,-1.3],[36.9,-1.2],[36.8,-1.2],[36.8,-1.3]]]}'
          spellCheck={false}
        />
      </label>
      {tileUrl || syntheticGrid ? (
        <SearchAreaMapEditor
          tileUrl={tileUrl ?? undefined}
          syntheticGrid={syntheticGrid}
          textareaId="search-area-polygon"
        />
      ) : (
        <p className="search-help">
          Interactive map drawing is not configured here. You can still enter a GeoJSON polygon.
        </p>
      )}
      {canClearArea && (
        <a href={loadedPageHref(clearFilters, sort, 1)}>Clear area and keep other filters</a>
      )}
    </fieldset>
  );
}
