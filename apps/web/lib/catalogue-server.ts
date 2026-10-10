import 'server-only';
import {createCatalogueLoader,resolveCatalogueConfig,type CatalogueQuery} from './catalogue';

/** Deployment-controlled environment only. Browser query/header values never configure the SDK or tenant. */
function loader(){return createCatalogueLoader(resolveCatalogueConfig(process.env));}
export function loadCatalogue(query:CatalogueQuery={}){return loader().list(query);}
export function loadProperty(id:string){return loader().detail(id);}
