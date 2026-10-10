import {RealtorApiClient} from '@realtor/api-client';
import {resolveDemoTenantSlug,type DemoTenantSlug} from '@realtor/demo';

export interface CatalogueEnvironment {
  readonly WEB_CATALOGUE_MODE?: string;
  readonly API_ORIGIN?: string;
  readonly ALLOW_LOOPBACK_API?: string;
  readonly WEB_CATALOGUE_DATA?: string;
  readonly TENANT_SLUG?: string;
  readonly NODE_ENV?: string;
}
export type CatalogueDataKind='synthetic'|'unspecified';
export type CatalogueConfig=
  | {readonly mode:'demo';readonly tenantSlug:DemoTenantSlug;readonly dataKind:'synthetic'}
  | {readonly mode:'connected';readonly tenantSlug:DemoTenantSlug;readonly dataKind:CatalogueDataKind;readonly apiOrigin:string;readonly allowLoopbackHttp:boolean;readonly limit:100};
export type CatalogueConfigResolution=
  | {readonly status:'ready';readonly config:CatalogueConfig}
  | {readonly status:'error';readonly code:'CONFIGURATION';readonly message:string};
export const CATALOGUE_CONFIGURATION_MESSAGE='The property catalogue is not configured correctly.';
/** The read-only loader never exposes enquiry submission or supplies a reviewed enquiry notice. */
export const CATALOGUE_READ_ONLY_NOTICE='catalogue-read-only';

/** Trusted deployment environment only; neither search parameters nor browser headers select this origin/company. */
export function resolveCatalogueConfig(environment:CatalogueEnvironment):CatalogueConfigResolution {
  try{
    const mode=environment.WEB_CATALOGUE_MODE??'demo';
    if(mode!=='demo'&&mode!=='connected')throw new Error('Unsupported mode');
    const tenantSlug=resolveDemoTenantSlug(environment.TENANT_SLUG);
    const dataKind=environment.WEB_CATALOGUE_DATA??'unspecified';
    if(dataKind!=='synthetic'&&dataKind!=='unspecified')throw new Error('Unsupported data declaration');
    if(mode==='demo')return Object.freeze({status:'ready',config:Object.freeze({mode,tenantSlug,dataKind:'synthetic'})});
    const optIn=environment.ALLOW_LOOPBACK_API;
    if(optIn!==undefined&&optIn!=='true'&&optIn!=='false')throw new Error('Unsupported loopback opt-in');
    const allowLoopbackHttp=optIn==='true';
    if(allowLoopbackHttp&&environment.NODE_ENV!=='development'&&environment.NODE_ENV!=='test')throw new Error('Loopback is development-only');
    if(typeof environment.API_ORIGIN!=='string')throw new Error('An API origin is required');
    // Reuse the actual SDK's HTTPS/origin/credential validation without making a request.
    new RealtorApiClient({baseUrl:environment.API_ORIGIN,privacyNoticeVersion:CATALOGUE_READ_ONLY_NOTICE,allowLoopbackHttp});
    return Object.freeze({status:'ready',config:Object.freeze({mode,tenantSlug,dataKind,apiOrigin:new URL(environment.API_ORIGIN).origin,allowLoopbackHttp,limit:100})});
  }catch{
    return Object.freeze({status:'error',code:'CONFIGURATION',message:CATALOGUE_CONFIGURATION_MESSAGE});
  }
}
