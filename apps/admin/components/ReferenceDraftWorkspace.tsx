'use client';
import { useMemo } from 'react';
import PrivateWorkspaceBoundary from './PrivateWorkspaceBoundary.tsx';
import ReferenceDraftEditor from './ReferenceDraftEditor.tsx';
import { createReferenceDraftClient } from '../lib/reference-draft-client.ts';
import type { ReferenceDraftScreen } from '../lib/reference-draft-screen.ts';
/** Browser callbacks stay on this side of the server/client boundary. */
type ReferenceWorkspaceProps = ReferenceDraftScreen & {
  videoEnabled?: boolean;
  floorPlanEnabled?: boolean;
};
export default function ReferenceDraftWorkspace(props: ReferenceWorkspaceProps) {
  const scope = [
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.scope.listingId,
    props.revision,
  ].join(':');
  return (
    <PrivateWorkspaceBoundary key={scope}>
      <ReferenceDraftContent {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function ReferenceDraftContent(props: ReferenceWorkspaceProps) {
  const client = useMemo(
    () => createReferenceDraftClient(props.scope),
    [props.scope.instanceId, props.scope.tenantId, props.scope.actorId, props.scope.listingId],
  );
  return (
    <>
      {props.floorPlanEnabled && (
        <p>
          <a href={`/drafts/${props.scope.listingId}/${props.revision}/floor-plan`}>
            Inspect or edit private floor plan
          </a>
        </p>
      )}
      {props.videoEnabled && (
        <p>
          <a href={`/drafts/${props.scope.listingId}/${props.revision}/video`}>
            Edit private video selection
          </a>
        </p>
      )}
      <p>
        <a href={`/drafts/${props.scope.listingId}/${props.revision}`}>
          Refresh current reference draft
        </a>
      </p>
      <p>
        <a href={`/drafts/${props.scope.listingId}/${props.revision}/submission`}>
          Inspect saved revision for submission or withdrawal
        </a>
      </p>
      <ReferenceDraftEditor {...props} client={client} onReceipt={() => window.location.reload()} />
    </>
  );
}
