export const propertyLinkPathPrefix = '/properties/';

export function propertyLinkOrigin(input: string): URL {
  const origin = new URL(input);
  if (
    input !== origin.origin ||
    origin.protocol !== 'https:' ||
    origin.port ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(origin.hostname) ||
    origin.hostname.endsWith('.localhost')
  )
    throw Error('Invalid property link origin.');
  return origin;
}

export function previewApplicationId(tenantSlug: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(tenantSlug))
    throw Error('Invalid application tenant.');
  return 'com.boniface.realtor.preview.' + tenantSlug.split('-').join('.');
}
