import { createInterface } from 'node:readline';
import { startCustomerPreview } from '../apps/api/dev/customer-preview.mjs';

const [tenantSlug, fault, extra] = process.argv.slice(2);
if (
  process.env.NODE_ENV !== 'development' ||
  !['realtime-estates', 'sample-homes'].includes(tenantSlug) ||
  extra !== undefined ||
  (fault !== undefined && fault !== '--lost-reply')
)
  throw Error('Choose an explicit synthetic development brand and optional --lost-reply.');

const preview = await startCustomerPreview({
  tenantSlug,
  mobileMode: 'synthetic-mobile-customer-v1',
  ...(fault ? { replyFault: 'lost-first-favourite-result-v1' } : {}),
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
