import { createInterface } from 'node:readline';
import { startCustomerPreview } from '../apps/api/dev/customer-preview.mjs';

const [tenantSlug, ...flags] = process.argv.slice(2);
if (
  process.env.NODE_ENV !== 'development' ||
  !['realtime-estates', 'sample-homes'].includes(tenantSlug) ||
  (flags.includes('--deletion') && !flags.includes('--push')) ||
  (flags.includes('--lost-deletion') && !flags.includes('--deletion')) ||
  new Set(flags).size !== flags.length ||
  flags.some(
    (flag) =>
      !['--lost-reply', '--lost-enquiry', '--push', '--deletion', '--lost-deletion'].includes(flag),
  )
)
  throw Error(
    'Choose an explicit synthetic development brand and optional --lost-reply, --lost-enquiry, --push, --deletion or --lost-deletion.',
  );

const preview = await startCustomerPreview({
  tenantSlug,
  mobileMode: 'synthetic-mobile-customer-v1',
  ...(flags.includes('--push') ? { pushMode: 'synthetic-customer-push-v1' } : {}),
  ...(flags.includes('--deletion') ? { deletionMode: 'synthetic-customer-deletion-v1' } : {}),
  ...(flags.includes('--lost-deletion')
    ? { deletionReplyFault: 'lost-first-deletion-result-v1' }
    : {}),
  ...(flags.includes('--lost-reply') ? { replyFault: 'lost-first-favourite-result-v1' } : {}),
  ...(flags.includes('--lost-enquiry')
    ? { enquiryReplyFault: 'lost-first-enquiry-result-v1' }
    : {}),
});
const input = createInterface({ input: process.stdin });
let closing;
function stop() {
  if (!closing) {
    closing = preview.close();
    input.close();
  }
  return closing;
}
console.log(
  JSON.stringify({
    TENANT_SLUG: tenantSlug,
    MOBILE_CATALOGUE_MODE: 'synthetic-reference-public-v1',
    MOBILE_CUSTOMER_MODE: 'synthetic-mobile-customer-v1',
    ...(flags.includes('--push') ? { MOBILE_PUSH_MODE: 'synthetic-customer-push-v1' } : {}),
    ...(flags.includes('--deletion')
      ? { MOBILE_DELETION_MODE: 'synthetic-customer-deletion-v1' }
      : {}),
    MOBILE_API_ORIGIN: preview.origin,
    MOBILE_ALLOW_LOOPBACK_API: 'true',
    listingId: preview.listingId,
    expiresAt: preview.expiresAt,
  }),
);
input.on('line', (line) => {
  if (line === 'quit') void stop();
});
input.on('close', () => void stop());
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
