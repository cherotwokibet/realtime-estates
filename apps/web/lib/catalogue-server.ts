import 'server-only';
import { cache } from 'react';
import { createCatalogueLoader, resolveCatalogueConfig, type CatalogueQuery } from './catalogue';

/** Deployment-controlled environment only. Browser query/header values never configure the SDK or tenant. */
function loader() {
  return createCatalogueLoader(resolveCatalogueConfig(process.env));
}
export function loadCatalogue(query: CatalogueQuery = {}) {
  return loader().list(query);
}
// Request/render-scoped reuse keeps page content and metadata on the same public snapshot.
export const loadProperty = cache(function loadProperty(id: string) {
  return loader().detail(id);
});
