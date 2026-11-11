import { RealtorApiClient } from '@realtor/api-client';
import type { MobileReferenceConfig } from './reference-catalogue.ts';

export const syntheticMobileNotice = 'synthetic-customer-preview-v1';
export function prepareSyntheticMobileEnquiry(
  config: MobileReferenceConfig,
  listingId: string,
  question: 'availability' | 'viewing',
  idempotencyKey: string,
  transport: typeof fetch,
) {
  if (
    config.mode !== 'synthetic-reference-public-v1' ||
    config.customerMode !== 'synthetic-mobile-customer-v1' ||
    !config.allowLoopbackHttp ||
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(config.apiOrigin) ||
    !['availability', 'viewing'].includes(question)
  )
    throw Error('Synthetic enquiries are unavailable.');
  return new RealtorApiClient({
    baseUrl: config.apiOrigin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: syntheticMobileNotice,
    fetch: transport,
  }).preparePublicEnquiry(
    {
      listingId,
      name: 'Synthetic Mobile Customer',
      email: 'mobile-customer@example.invalid',
      phone: null,
      message:
        question === 'availability'
          ? 'Synthetic mobile enquiry asking about property availability.'
          : 'Synthetic mobile enquiry asking about a possible viewing.',
      origin: 'mobile',
      noticeVersion: syntheticMobileNotice,
      noticeAcknowledged: true,
    },
    idempotencyKey,
  );
}
