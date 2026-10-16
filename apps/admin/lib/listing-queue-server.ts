import 'server-only';
import {
  RealtorApiClient,
  type StaffListingPage,
  type StaffListingSummary,
} from '@realtor/api-client';
import { previewConfiguration } from './staff-preview-policy.ts';
/** Explicit local synthetic identity only. Never return credentials or use browser-selected scope. */
export async function readStaffListingQueue(
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof globalThis.fetch,
): Promise<StaffListingPage> {
  const config = previewConfiguration(env),
    client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
      ...(transport ? { fetch: transport } : {}),
    });
  return client.listStaffListingsV2({
    bearerToken: config.bearerToken,
    limit: 25,
    timeoutMs: 10000,
  });
}
/** Fresh exact listing/predecessor read; no queue slice or browser-selected identity supplies authority. */
export async function readStaffListingDetail(
  listingId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof globalThis.fetch,
): Promise<StaffListingSummary> {
  const config = previewConfiguration(env),
    client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
      ...(transport ? { fetch: transport } : {}),
    });
  return client.getStaffListingV2(listingId, { bearerToken: config.bearerToken, timeoutMs: 10000 });
}
