'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
export interface PublicGalleryPhoto {
  readonly src: string;
  readonly alt: string;
}
function Photo({
  photo,
  number,
  allowed,
  onSettled,
}: {
  photo: PublicGalleryPhoto;
  number: number;
  allowed: boolean;
  onSettled: (number: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // The first image may finish before hydration installs its load listener.
    if (allowed && image.current?.complete) {
      if (image.current.naturalWidth === 0) setFailed(true);
      onSettled(number);
    }
  }, [allowed, number, onSettled]);
  return (
    <figure className="public-gallery-item">
      <div className="gallery-photo">
        {!allowed ? (
          <p className="public-photo-failure">Photo {number} waiting to load…</p>
        ) : failed ? (
          <p role="status" className="public-photo-failure">
            Photo {number} unavailable. The listing or image may have changed. Refresh the property
            page to check its current details.
          </p>
        ) : (
          <img
            ref={image}
            src={photo.src}
            alt={photo.alt || `Property photo ${number}`}
            loading={number <= 3 ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => onSettled(number)}
            onError={() => {
              setFailed(true);
              onSettled(number);
            }}
          />
        )}
      </div>
      <figcaption>
        Photo {number} · {photo.alt || 'Property image'}
      </figcaption>
    </figure>
  );
}
export function PublicPhotoGallery({ photos }: { photos: readonly PublicGalleryPhoto[] }) {
  const [released, setReleased] = useState(1);
  const settled = useCallback(
    (number: number) => setReleased((current) => Math.max(current, number + 1)),
    [],
  );
  return (
    <section aria-labelledby="public-gallery-title" className="public-photo-gallery">
      <h2 id="public-gallery-title">Property photos</h2>
      <p>
        Fictional test images · {photos.length} photos. Image access is checked again when each
        photo loads.
      </p>
      <noscript>
        <p>JavaScript is off. Open each current property photo directly:</p>
        <ol>
          {photos.map((photo, index) => (
            <li key={photo.src}>
              <a href={photo.src}>
                Photo {index + 1} · {photo.alt || 'Property image'}
              </a>
            </li>
          ))}
        </ol>
      </noscript>
      <div className="public-gallery-grid">
        {photos.slice(0, 3).map((photo, index) => (
          <Photo
            key={photo.src}
            photo={photo}
            number={index + 1}
            allowed={index < released}
            onSettled={settled}
          />
        ))}
      </div>
      {photos.length > 3 && (
        <details className="gallery-more">
          <summary>Show {photos.length - 3} more property photos</summary>
          <div className="public-gallery-grid">
            {photos.slice(3).map((photo, index) => (
              <Photo
                key={photo.src}
                photo={photo}
                number={index + 4}
                allowed={index + 3 < released}
                onSettled={settled}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
