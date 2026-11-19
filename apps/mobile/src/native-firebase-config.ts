import { propertyLinkOrigin } from '@realtor/domain';
export interface NativeFirebaseConfig {
  readonly mode: 'firebase-native-customer-v1';
  readonly tenantId: string;
  /** Reviewed public Firebase-authorized customer gateway, never a private Cloud Run IAM URL. */
  readonly apiOrigin: string;
  readonly propertyLinkOrigin?: string;
  readonly firebase: Readonly<{
    apiKey: string;
    projectId: string;
    authDomain: string;
    appId: string;
  }>;
}
const fail = (): never => {
  throw Error('Account configuration unavailable.');
};
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length) return fail();
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key];
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    out[key] = d.value;
  }
  return out;
}
/** Public data only; rejects credential/authority extras and accessors before evaluating values. */
export function readNativeFirebaseConfig(value: unknown): NativeFirebaseConfig | null {
  if (value === undefined) return null;
  try {
    const c = record(value, [
      'mode',
      'tenantId',
      'apiOrigin',
      'firebase',
      ...(value && Object.hasOwn(value, 'propertyLinkOrigin') ? ['propertyLinkOrigin'] : []),
    ]);
    if (Object.hasOwn(c, 'propertyLinkOrigin') && typeof c.propertyLinkOrigin !== 'string')
      return fail();
    const links =
      typeof c.propertyLinkOrigin === 'string'
        ? propertyLinkOrigin(c.propertyLinkOrigin).origin
        : undefined;
    const f = record(c.firebase, ['apiKey', 'projectId', 'authDomain', 'appId']);
    if (
      c.mode !== 'firebase-native-customer-v1' ||
      typeof c.tenantId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        c.tenantId,
      ) ||
      typeof c.apiOrigin !== 'string'
    )
      return fail();
    const origin = new URL(c.apiOrigin);
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== c.apiOrigin ||
      origin.username ||
      origin.password ||
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    )
      return fail();
    if (
      typeof f.projectId !== 'string' ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(f.projectId) ||
      f.authDomain !== f.projectId + '.firebaseapp.com' ||
      typeof f.apiKey !== 'string' ||
      !/^AIza[A-Za-z0-9_-]{30,60}$/.test(f.apiKey) ||
      typeof f.appId !== 'string' ||
      !/^1:[0-9]{1,24}:web:[0-9a-f]{6,64}$/.test(f.appId)
    )
      return fail();
    return Object.freeze({
      mode: c.mode,
      tenantId: c.tenantId,
      apiOrigin: c.apiOrigin,
      ...(links ? { propertyLinkOrigin: links } : {}),
      firebase: Object.freeze({
        apiKey: f.apiKey,
        projectId: f.projectId,
        authDomain: f.authDomain as string,
        appId: f.appId,
      }),
    });
  } catch {
    return fail();
  }
}
