import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { selectListingReferenceAttributes } from '@realtor/domain';
import { previewConfiguration } from './staff-preview-policy.ts';
import { readRevisionProtocolScreen } from './revision-protocol-screen.ts';
import type { ReferenceDraftScreen } from './reference-draft-screen.ts';
import { readReferenceDraftScreen } from './reference-draft-screen.ts';

export type MixedDraftScreen =
  | Readonly<{
      kind: 'ordinary';
      instanceId: string;
      context: Awaited<ReturnType<typeof readRevisionProtocolScreen>>;
    }>
  | Readonly<{ kind: 'reference'; screen: ReferenceDraftScreen }>;

/** A failed read never falls back to v2. Every read uses one captured server configuration. */
export async function readMixedDraftScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
): Promise<MixedDraftScreen> {
  const captured = Object.freeze(
    Object.fromEntries(
      [
        'NODE_ENV',
        'STAFF_PREVIEW_MODE',
        'STAFF_PREVIEW_REFERENCE',
        'STAFF_PREVIEW_REFERENCE_MODERATION',
        'STAFF_PREVIEW_API_ORIGIN',
        'STAFF_PREVIEW_TOKEN',
        'STAFF_PREVIEW_INSTANCE',
      ].map((key) => [key, env[key]]),
    ),
  );
  const config = previewConfiguration(captured);
  const initial = await readRevisionProtocolScreen(listingId, revision, captured, transport);
  if (initial.protocol.protocol === 'ordinary-v2') {
    if (!initial.protocol.editable) throw Error('Current editable draft required.');
    return Object.freeze({
      kind: 'ordinary',
      instanceId: initial.scope.instanceId,
      context: initial,
    });
  }
  if (captured.STAFF_PREVIEW_REFERENCE_MODERATION !== 'synthetic-reference-transition-v1')
    throw Error('Reference snapshot read capability required.');
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const options = { bearerToken: config.bearerToken, timeoutMs: 10000 };
  const context = await client.getSyntheticReferenceRevisionContextV3(
    listingId,
    initial.protocol.revision,
    initial.protocol.revisionVersion,
    options,
  );
  const active = await client.getSyntheticReferenceCatalogueV3('current', options);
  const final = await readRevisionProtocolScreen(listingId, revision, captured, transport);
  if (
    JSON.stringify(initial) !== JSON.stringify(final) ||
    context.review.listingVersion !== final.protocol.listingVersion ||
    context.review.revisionVersion !== final.protocol.revisionVersion ||
    context.review.state !== final.protocol.state
  )
    throw Error('Draft context changed; reload before editing.');
  const attributes = context.review.attributes;
  const initialSelection = selectListingReferenceAttributes(
    {
      catalogueVersion: attributes.catalogueVersion,
      location: {
        countyId: attributes.location.county?.id ?? null,
        localityId: attributes.location.locality?.id ?? null,
        neighbourhoodId: attributes.location.neighbourhood?.id ?? null,
      },
      amenityIds: attributes.amenities.map((item) => item.id),
    },
    context.catalogue,
    context.review.content.propertyType,
  );
  return Object.freeze({
    kind: 'reference',
    screen: Object.freeze({
      scope: Object.freeze({ ...final.scope, listingId }),
      revision: final.protocol.revision,
      expectedVersion: final.protocol.revisionVersion,
      content: context.review.content,
      catalogue: context.catalogue,
      initialSelection,
      editingDisabled: !final.protocol.editable || active.version !== context.catalogue.version,
    }),
  });
}

/** Explicit adoption also requires compatible saved-snapshot readers before presenting a writer. */
export async function readReferenceEntryScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
): Promise<ReferenceDraftScreen> {
  const captured = Object.freeze({ ...env });
  if (captured.STAFF_PREVIEW_REFERENCE_MODERATION !== 'synthetic-reference-transition-v1')
    throw Error('Compatible reference readers required before adoption.');
  const entry = await readMixedDraftScreen(listingId, revision, captured, transport);
  if (entry.kind === 'reference') return entry.screen;
  const screen = await readReferenceDraftScreen(listingId, revision, captured, transport);
  const final = await readRevisionProtocolScreen(listingId, revision, captured, transport);
  if (
    JSON.stringify(entry.context) !== JSON.stringify(final) ||
    screen.scope.instanceId !== final.scope.instanceId ||
    screen.scope.tenantId !== final.scope.tenantId ||
    screen.scope.actorId !== final.scope.actorId ||
    screen.scope.listingId !== final.protocol.listingId ||
    screen.revision !== final.protocol.revision ||
    screen.expectedVersion !== final.protocol.revisionVersion
  )
    throw Error('Adoption target changed; reload before editing.');
  return screen;
}
