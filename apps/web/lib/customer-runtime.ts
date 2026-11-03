import { loadProperty } from './catalogue-server';
import 'server-only';
import { createHash } from 'node:crypto';
import { customerPreviewConfig, CustomerSessionBridge } from './customer-session';
import { tenantManifest, tenantSlug } from './tenant';
const key = Symbol.for('realtor.synthetic-customer-bridge.v1');
type Runtime = { fingerprint: string; bridge: CustomerSessionBridge };
const host = globalThis as typeof globalThis & { [key]?: Runtime };
export function customerBridge(): CustomerSessionBridge | null {
  const source = process.env.WEB_CUSTOMER_PREVIEW_CONFIG;
  if (source === undefined || process.env.NODE_ENV === 'production') return null;
  const expectedTenant =
    tenantManifest.status === 'configured'
      ? tenantManifest.manifest.brand.tenantId
      : tenantSlug === 'sample-homes'
        ? '00000000-0000-4000-8000-000000000002'
        : '00000000-0000-4000-8000-000000000001';
  try {
    const config = customerPreviewConfig(source, expectedTenant, process.env.NODE_ENV);
    if (!config) return null;
    const fingerprint = createHash('sha256').update(source).digest('hex');
    if (host[key]?.fingerprint !== fingerprint) {
      host[key]?.bridge.close();
      host[key] = {
        fingerprint,
        bridge: new CustomerSessionBridge(config, fetch, Date.now, async (id) => {
          const r = await loadProperty(id);
          return r.mode !== 'error' && r.status === 'found'
            ? {
                title: r.property.title,
                priceMinor: r.property.priceMinor,
                purpose: r.property.purpose,
                rentalPeriod: r.property.rentalPeriod,
              }
            : null;
        }),
      };
    }
    return host[key]!.bridge;
  } catch {
    host[key]?.bridge.close();
    delete host[key];
    return null;
  }
}
