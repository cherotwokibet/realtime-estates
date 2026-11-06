'use client';
import { useEffect, useState } from 'react';
import { readPublishedFloorPlanImageBytes } from '@realtor/api-client';
import type { PublicFloorPlanResult } from '../lib/public-floor-plan.ts';
export default function PublicFloorPlan({ result }: { result: PublicFloorPlanResult }) {
  const [url, setUrl] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let live = true,
      owned: string | null = null;
    setUrl(null);
    setFailed(false);
    if (result.status === 'ready' && result.saved.floorPlan) {
      const saved = result.saved;
      void readPublishedFloorPlanImageBytes(
        `/api/public-floor-plans/${saved.listingId}/${saved.revision}/${saved.approvedVersion}`,
        saved,
        controller.signal,
      ).then(
        (data) => {
          if (!live || controller.signal.aborted) return;
          owned = URL.createObjectURL(new Blob([data], { type: 'image/webp' }));
          setUrl(owned);
        },
        () => {
          if (live) setFailed(true);
        },
      );
    }
    return () => {
      live = false;
      controller.abort();
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [result]);
  if (result.status === 'off') return null;
  const meta = result.status === 'ready' ? result.saved.floorPlan : null;
  return (
    <section aria-label="Floor plan">
      <h2>Floor plan</h2>
      {result.status === 'unavailable' || failed ? (
        <p role="status">Floor plan unavailable. Refresh the property to check current details.</p>
      ) : !meta ? (
        <p>No floor plan supplied for this approved revision.</p>
      ) : url ? (
        <figure style={{ margin: '1rem 0' }}>
          <img
            src={url}
            alt="Approved property floor plan"
            width={meta.width}
            height={meta.height}
            style={{ maxWidth: '100%', height: 'auto' }}
            onError={() => {
              URL.revokeObjectURL(url);
              setUrl(null);
              setFailed(true);
            }}
          />
          <figcaption>Supplied floor plan</figcaption>
        </figure>
      ) : (
        <p role="status">Loading floor plan…</p>
      )}
    </section>
  );
}
