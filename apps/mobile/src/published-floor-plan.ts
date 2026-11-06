import { RealtorApiClient, type FloorPlanImageDigest } from '@realtor/api-client';
import type { MobileReferenceConfig } from './reference-catalogue.ts';
export type MobileFloorPlanResult =
  | Readonly<{ status: 'off' | 'unavailable' }>
  | Readonly<{
      status: 'ready';
      image: null | Readonly<{ uri: string; width: number; height: number }>;
    }>;

/** In-memory encoding only after shared SDK verification. No provider URL, disk or offline cache. */
async function imageUri(data: Uint8Array, signal: AbortSignal) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += 12288) {
    if (signal.aborted) throw Error('Cancelled.');
    let chunk = '';
    const end = Math.min(offset + 12288, data.length);
    for (let i = offset; i < end; i += 3) {
      const a = data[i]!,
        b = data[i + 1],
        c = data[i + 2];
      chunk +=
        alphabet[a >>> 2]! +
        alphabet[((a & 3) << 4) | ((b ?? 0) >>> 4)]! +
        (b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >>> 6)]!) +
        (c === undefined ? '=' : alphabet[c & 63]!);
    }
    chunks.push(chunk);
    if (offset % (12288 * 16) === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (signal.aborted) throw Error('Cancelled.');
  return 'data:image/webp;base64,' + chunks.join('');
}
/** Trusted native adapter supplies streaming fetch and platform SHA-256, never caller-controlled. */
export async function loadMobilePublishedFloorPlan(
  config: MobileReferenceConfig,
  property: { id: string; revision: number; reference: { revisionVersion: string | null } },
  signal: AbortSignal,
  platform: { fetch: typeof fetch; digest: FloorPlanImageDigest },
): Promise<MobileFloorPlanResult> {
  if (config.mode !== 'synthetic-reference-public-v1' || config.floorPlanMode === undefined)
    return Object.freeze({ status: 'off' });
  try {
    if (
      config.floorPlanMode !== 'synthetic-floor-plan-publication-v1' ||
      signal.aborted ||
      property.reference.revisionVersion === null
    )
      throw Error();
    const client = new RealtorApiClient({
      baseUrl: config.apiOrigin,
      allowLoopbackHttp: config.allowLoopbackHttp,
      privacyNoticeVersion: 'mobile-public-floor-plan',
      fetch: platform.fetch,
      floorPlanImageDigest: platform.digest,
    });
    const saved = await client.getPublishedFloorPlan(property.id, property.revision, { signal });
    if (saved.approvedVersion !== property.reference.revisionVersion || signal.aborted)
      throw Error();
    if (saved.floorPlan === null) return Object.freeze({ status: 'ready', image: null });
    const output = await client.getPublishedFloorPlanImage(
      property.id,
      property.revision,
      saved.approvedVersion,
      { signal },
    );
    const uri = await imageUri(output.data, signal);
    if (signal.aborted) throw Error();
    return Object.freeze({
      status: 'ready',
      image: Object.freeze({
        uri,
        width: output.metadata.floorPlan!.width,
        height: output.metadata.floorPlan!.height,
      }),
    });
  } catch {
    return Object.freeze({ status: 'unavailable' });
  }
}
