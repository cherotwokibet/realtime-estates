import { configuredHostedApiTransport } from '@realtor/api/dist/cloud-run-invocation.js';
import 'server-only';
import { readFirebaseBrowserEnvironment } from '@realtor/api/dist/browser-identity-runtime.js';
import { createStaffOriginals } from '@realtor/api/dist/staff-browser-originals.js';
import { createHostedStaffBrowser } from '@realtor/api/dist/hosted-staff-browser.js';
import { hostedIdentity } from './hosted-identity';
let instance: ReturnType<typeof createHostedStaffBrowser> | undefined;
export function hostedStaff() {
  if (process.env.HOSTED_STAFF_API_ORIGIN === undefined) return null;
  if (instance) return instance;
  const settings = readFirebaseBrowserEnvironment(process.env),
    notice = process.env.PRIVACY_NOTICE_VERSION;
  if (!settings || !notice) throw Error('Hosted staff setup is unavailable.');
  const origin = new URL(process.env.HOSTED_STAFF_API_ORIGIN);
  if (origin.origin !== process.env.HOSTED_STAFF_API_ORIGIN || origin.protocol !== 'https:')
    throw Error('Hosted HTTPS API required.');
  instance = createHostedStaffBrowser(
    {
      applicationOrigin: settings.config.applicationOrigin,
      apiOrigin: origin.origin,
      tenantId: settings.config.tenantId,
      privacyNoticeVersion: notice,
    },
    hostedIdentity,
    createStaffOriginals(hostedIdentity.database, settings.encryptionKey),
    configuredHostedApiTransport(process.env, origin.origin, settings.config.projectId),
  );
  return instance;
}
