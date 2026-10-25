import type { CatalogueFilters } from '../lib/catalogue.ts';
import { loadedPageHref, type LoadedBrowse } from '../lib/catalogue-browse.ts';
export default function LoadedCataloguePager({
  browse,
  filters,
}: {
  browse: LoadedBrowse;
  filters: CatalogueFilters;
}) {
  if (browse.error || filters.error) return null;
  return (
    <nav className="loaded-pager" aria-label="Loaded catalogue pages">
      <p>
        {browse.outOfRange
          ? 'That page is outside the loaded results.'
          : `Page ${browse.page} of ${browse.pageCount} · ${browse.start}–${browse.end} of ${browse.matchingLoadedCount} matching loaded properties.`}
      </p>
      {browse.outOfRange ? (
        <a href={loadedPageHref(filters, browse.sort, 1)}>Return to first loaded page</a>
      ) : (
        <>
          {browse.page > 1 && (
            <a rel="prev" href={loadedPageHref(filters, browse.sort, browse.page - 1)}>
              Previous loaded page
            </a>
          )}
          {browse.page < browse.pageCount && (
            <a rel="next" href={loadedPageHref(filters, browse.sort, browse.page + 1)}>
              Next loaded page
            </a>
          )}
        </>
      )}
    </nav>
  );
}
