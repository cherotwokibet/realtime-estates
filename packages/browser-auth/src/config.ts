export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
  readonly authTenantId?: string;
}
/** Public SDK fields only. Never serialize the server identity/database environment into React props. */
export function readFirebaseWebConfig(
  source: string | undefined,
  projectId: string,
  authTenantId?: string,
): FirebaseWebConfig | null {
  if (source === undefined) return null;
  try {
    if (source.length > 4096 || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw Error();
    const c = JSON.parse(source);
    if (
      !c ||
      typeof c !== 'object' ||
      Array.isArray(c) ||
      Object.keys(c).sort().join(',') !== 'apiKey,appId,authDomain,projectId' ||
      c.projectId !== projectId ||
      c.authDomain !== projectId + '.firebaseapp.com' ||
      typeof c.apiKey !== 'string' ||
      !/^AIza[A-Za-z0-9_-]{30,60}$/.test(c.apiKey) ||
      typeof c.appId !== 'string' ||
      !/^1:[0-9]{1,24}:web:[0-9a-f]{6,64}$/.test(c.appId) ||
      (authTenantId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(authTenantId))
    )
      throw Error();
    return Object.freeze({
      apiKey: c.apiKey,
      authDomain: c.authDomain,
      projectId,
      appId: c.appId,
      ...(authTenantId ? { authTenantId } : {}),
    });
  } catch {
    throw Error('Sign-in configuration unavailable.');
  }
}
