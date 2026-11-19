import 'server-only';
import {
  configuredBrowserIdentityRuntime,
  readFirebaseBrowserEnvironment,
} from '@realtor/api/dist/browser-identity-runtime.js';
import { readFirebaseWebConfig } from '@realtor/browser-auth/config';
export const hostedIdentity = configuredBrowserIdentityRuntime(undefined, 'customer');
export function hostedWebIdentityConfig() {
  try {
    const settings = readFirebaseBrowserEnvironment(process.env);
    return settings
      ? readFirebaseWebConfig(
          process.env.FIREBASE_WEB_CONFIG,
          settings.config.projectId,
          settings.config.authTenantId,
        )
      : null;
  } catch {
    return null;
  }
}
