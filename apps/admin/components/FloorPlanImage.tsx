'use client';
import { useEffect, useState } from 'react';
import type { FloorPlanState } from '@realtor/domain';
import type { VideoScope } from '../lib/listing-video-session.ts';
import { loadFloorPlanImage } from '../lib/floor-plan-image.ts';
export default function FloorPlanImage({
  scope,
  state,
}: {
  scope: VideoScope;
  state: FloorPlanState;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let live = true,
      owned: string | null = null;
    setUrl(null);
    setFailed(false);
    if (state.floorPlan)
      void loadFloorPlanImage(scope, state, controller.signal).then(
        (blob) => {
          if (!live || controller.signal.aborted) return;
          owned = URL.createObjectURL(blob);
          setUrl(owned);
        },
        () => {
          if (live) setFailed(true);
        },
      );
    return () => {
      live = false;
      controller.abort();
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [scope, state]);
  if (!state.floorPlan) return null;
  return (
    <figure aria-label="Saved private floor plan">
      {url ? (
        <img
          src={url}
          alt="Saved floor plan"
          width={state.floorPlan.width}
          height={state.floorPlan.height}
          style={{ maxWidth: '100%', height: 'auto' }}
          onError={() => {
            URL.revokeObjectURL(url);
            setUrl(null);
            setFailed(true);
          }}
        />
      ) : (
        <p role="status">
          {failed
            ? 'Private image unavailable. Reload fresh access to try again.'
            : 'Loading the saved private floor plan…'}
        </p>
      )}
      <figcaption>
        Saved floor plan · {state.floorPlan.width} × {state.floorPlan.height} pixels
      </figcaption>
    </figure>
  );
}
