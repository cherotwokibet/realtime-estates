import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { previewConfiguration } from './staff-preview-policy.ts';
import type { ReferenceDraftEditorProps } from '../components/ReferenceDraftEditor.tsx';
export type ReferenceDraftScreen = Omit<ReferenceDraftEditorProps, 'client' | 'onReceipt'>;
/** No request-selected company, token or role. Each upstream read rechecks current API/database access. */
export async function readReferenceDraftScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
): Promise<ReferenceDraftScreen> {
  const config = previewConfiguration(env);
  if (
    env.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(listingId) ||
    !/^[1-9]\d{0,9}$/.test(revision) ||
    BigInt(revision) > 2147483647n
  )
    throw Error('Reference screen unavailable.');
  const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
      ...(transport ? { fetch: transport } : {}),
    }),
    options = { bearerToken: config.bearerToken, timeoutMs: 10000 };
  const current = await client.getSyntheticReferenceSessionV3(options),
    workspace = await client.getStaffDraftWorkspaceV2(listingId, Number(revision), options);
  if (workspace.draft.state !== 'draft')
    throw Error('Only current editable drafts support reference adoption.');
  const catalogue = await client.getSyntheticReferenceCatalogueV3('current', options);
  return Object.freeze({
    scope: Object.freeze({
      instanceId: config.instanceId,
      tenantId: current.tenantId,
      actorId: current.actorId,
      listingId,
    }),
    revision: workspace.draft.revision,
    expectedVersion: workspace.draft.version,
    content: workspace.draft.content,
    catalogue,
  });
}
