/** Actual synthetic PNG upload/codec/attachment/moderation fixture; no privileged SQL seeding. */
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
export async function publishNativeGallery(
  preview,
  { listingId = preview.listingId, author = preview.bearerToken, reviewer = author } = {},
) {
  const api = new RealtorApiClient({
    baseUrl: preview.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
  });
  const options = { bearerToken: author };
  const reviewOptions = { bearerToken: reviewer };
  let workspace = await api.getStaffDraftWorkspaceV2(listingId, 1, options);
  if (workspace.photos.length !== 0)
    throw Error('Public gallery fixture requires empty fresh native draft.');
  for (let n = 0; n < 4; n++) {
    const registration = await api.registerMediaUploadV2(
      listingId,
      1,
      {
        registrationId: randomUUID(),
        expectedVersion: workspace.draft.version,
        altText: `Fictional public gallery pattern ${n + 1}`,
      },
      options,
    );
    const url = `${preview.origin}/v2/staff/listings/${listingId}/revisions/1/media-jobs/${registration.jobId}/uploads/${randomUUID()}`;
    const result = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${author}`,
        'Content-Type': 'application/octet-stream',
      },
      body: syntheticPng(320 + n * 8, 240, (x, y) => [
        (x * 2 + n * 53) % 256,
        (y * 3 + n * 31) % 256,
        (x + y + n * 23) % 256,
        255,
      ]),
    });
    if (result.status !== 200 || (await result.json()).state !== 'verified')
      throw Error('Actual public-gallery image conversion failed.');
    const operationId = randomUUID();
    await api.createMediaAttachIntentV2(
      listingId,
      1,
      { operationId, jobId: registration.jobId, expectedVersion: workspace.draft.version },
      options,
    );
    const attached = await api.finalizeMediaAttachIntentV2(listingId, 1, operationId, options);
    if (attached.status !== 'applied') throw Error('Actual public-gallery attachment failed.');
    workspace = await api.getStaffDraftWorkspaceV2(listingId, 1, options);
  }
  const submitted = await api.submitStaffDraftV2(
    listingId,
    1,
    { expectedVersion: workspace.draft.version },
    options,
  );
  const listing = await api.getStaffListingV2(listingId, options);
  const confirmed = await api.controlListingV2(
    {
      operationId: randomUUID(),
      kind: 'confirm_availability',
      listingId: listingId,
      expectedListingVersion: listing.version,
      availability: 'available',
    },
    options,
  );
  if (confirmed.decision.outcome !== 'applied')
    throw Error('Synthetic availability confirmation failed.');
  await api.decideReviewV2(
    listingId,
    1,
    { expectedVersion: submitted.version, decision: 'approve', reason: null },
    reviewOptions,
  );
  const page = await api.listPropertiesV2({ limit: 100 });
  const property = page.items.find((p) => p.id === listingId);
  if (!property || property.photos.length !== 4)
    throw Error('Published synthetic catalogue omitted verified gallery.');
  return { api, options, property };
}
export function publicGalleryImageUrl(preview, property, photo) {
  const match = /^synthetic\/[0-9a-f-]{36}\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.webp$/.exec(
    photo.key,
  );
  if (!match) throw Error('Unexpected synthetic public photo key.');
  return `${preview.origin}/v2/public/listings/${property.id}/revisions/${property.revision}/photos/${match[1]}/${match[2]}.webp`;
}
