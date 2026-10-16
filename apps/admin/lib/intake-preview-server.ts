import 'server-only';
import { handleSyntheticEnquiry } from '@realtor/api-client';
import { getEnquiryPreviewScope } from './enquiry-preview-server.ts';
import { assertPreviewRequest } from './staff-preview-policy.ts';
export function intakePreviewRequest(request: Request): Promise<Response> {
  return handleSyntheticEnquiry(request, {
    apiOrigin: process.env.STAFF_PREVIEW_API_ORIGIN ?? '',
    noticeVersion: 'synthetic-staff-notice-v1',
    authorize: (r) => {
      const scope = getEnquiryPreviewScope('admin');
      assertPreviewRequest(r, scope.instanceId);
    },
  });
}
