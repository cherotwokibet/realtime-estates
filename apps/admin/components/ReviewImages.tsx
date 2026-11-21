'use client';
import { useEffect, useState, useRef } from 'react';
import type { ReviewMediaGallery } from '@realtor/domain';
import { readReviewGallery, ReviewGalleryAccessDenied } from '../lib/review-gallery-client.ts';
import {
  createReviewImageBatch,
  type PrivateImageState,
  type PrivateImageBatch,
} from '../lib/private-image.ts';
export default function ReviewImages({
  instanceId,
  listingId,
  revision,
  version,
  onDenied,
}: {
  instanceId: string;
  listingId: string;
  revision: number;
  version: string;
  onDenied?: () => void;
}) {
  const batchRef = useRef<PrivateImageBatch | undefined>(undefined);
  const [gallery, setGallery] = useState<ReviewMediaGallery | null>(null),
    [images, setImages] = useState<Record<string, PrivateImageState>>({}),
    [message, setMessage] = useState('Loading verified review photos…');
  useEffect(() => {
    let active = true,
      batch: PrivateImageBatch | undefined;
    const controller = new AbortController();
    setGallery(null);
    setImages({});
    setMessage('Loading verified review photos…');
    readReviewGallery({ instanceId, listingId, revision, version }, controller.signal)
      .then((value) => {
        if (!active) return;
        setGallery(value);
        setMessage('Images belong to this exact pending revision.');
        batch = createReviewImageBatch(
          value.photos.map((photo) => ({
            instanceId,
            listingId,
            revision,
            version,
            mediaId: photo.id,
          })),
          {
            onState: (state) => {
              if (active) setImages((old) => ({ ...old, [state.mediaId]: state }));
            },
            onStale: () => {
              if (active) {
                setImages({});
                setMessage(
                  'Review changed. Check the latest revision before inspecting photos again.',
                );
              }
            },
            onDenied: () => {
              if (active) {
                setGallery(null);
                setImages({});
                onDenied?.();
                setMessage(
                  'Photo access is unavailable. Check the latest review before continuing.',
                );
              }
            },
          },
        );
        batchRef.current = batch;
        batch.start();
      })
      .catch((error) => {
        if (active) {
          if (error instanceof ReviewGalleryAccessDenied) onDenied?.();
          setGallery(null);
          setImages({});
          setMessage(
            'Verified photos are unavailable. Check the latest review; references alone do not verify images.',
          );
        }
      });
    return () => {
      active = false;
      controller.abort();
      batch?.close();
      if (batchRef.current === batch) batchRef.current = undefined;
    };
  }, [instanceId, listingId, revision, version, onDenied]);
  return (
    <div aria-label="Verified review photos">
      <p role="status">{message}</p>
      {gallery && (
        <div className="review-image-grid">
          {gallery.photos.map((photo, index) => {
            const image = images[photo.id];
            return (
              <figure key={photo.id}>
                {image?.phase === 'ready' && image.url ? (
                  <img
                    src={image.url}
                    alt={photo.alt || `Review photo ${index + 1}`}
                    onError={() => {
                      batchRef.current?.decodeFailed(photo.id, image.url!);
                      setMessage('An image could not be decoded. Check the latest review.');
                    }}
                  />
                ) : (
                  <div className="review-image-placeholder">
                    {image?.phase === 'loading' ? 'Loading image…' : 'Image unavailable'}
                  </div>
                )}
                <figcaption>
                  {index + 1}. {photo.alt || 'No description supplied'}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
