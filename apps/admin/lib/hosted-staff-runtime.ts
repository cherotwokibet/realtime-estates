import 'server-only';
import { Pool } from 'pg';
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
  const pool = new Pool({
    connectionString: settings.databaseUrl,
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    query_timeout: 5000,
  });
  pool.on('error', () => {
    /* Never log credential-bearing errors. */
  });
  instance = createHostedStaffBrowser(
    {
      applicationOrigin: settings.config.applicationOrigin,
      apiOrigin: origin.origin,
      tenantId: settings.config.tenantId,
      privacyNoticeVersion: notice,
    },
    hostedIdentity,
    createStaffOriginals(pool, settings.encryptionKey),
  );
  return instance;
}
