import Image from 'next/image';
import { publicIntakeConfig } from '../../../lib/intake-config';
import { publicPhotoPath, publicPhotosEnabled } from '../../../lib/public-photos';
import { PublicPhotoGallery } from '../../../components/PublicPhotoGallery';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatKes, kesFromMinor } from '@realtor/domain';
import { loadProperty } from '../../../lib/catalogue-server';
import { propertyPageMetadata } from '../../../lib/public-seo';
import { publicSeoPolicy } from '../../../lib/public-seo-server';
import { approvedPresentation, readApprovedCompany } from '../../../lib/approved-company';
import {
  CatalogueBanner,
  CatalogueProblem,
  ConnectedPublicHeader as PublicHeader,
  ConnectedPublicFooter as PublicFooter,
} from '../../../components/ConnectedPublicShell';
import {
  PricingDisclosureCard,
  PricingDisclosureSummary,
} from '../../../components/PricingDisclosure';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const result = await loadProperty((await params).id);
  if (result.mode !== 'error' && result.status === 'not_found') notFound();
  return propertyPageMetadata(
    publicSeoPolicy,
    approvedPresentation(await readApprovedCompany()).brand.name,
    result,
  );
}
export default async function Property({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadProperty(id);
  if (result.mode === 'error')
    return (
      <>
        <CatalogueBanner mode="unavailable" />
        <PublicHeader />
        <main id="main" tabIndex={-1} className="container detail-page">
          <CatalogueProblem message={result.message} />
        </main>
        <PublicFooter mode="unavailable" />
      </>
    );
  if (result.status === 'not_found') notFound();
  if (result.status === 'incomplete')
    return (
      <>
        <CatalogueBanner mode={result.mode} />
        <PublicHeader />
        <main id="main" tabIndex={-1} className="container detail-page">
          <CatalogueProblem message={result.message} incomplete />
        </main>
        <PublicFooter mode={result.mode} />
      </>
    );
  const p = result.property,
    mode = result.mode,
    synthetic = result.dataKind === 'synthetic';
  let propertyEnquiry = false;
  try {
    propertyEnquiry =
      publicIntakeConfig(process.env).allowProperty && mode === 'connected' && synthetic;
  } catch {}
  const price = formatKes(kesFromMinor(p.priceMinor));
  const publicPhotos =
    mode === 'connected' && publicPhotosEnabled(process.env)
      ? p.photos.flatMap((photo) => {
          const src = publicPhotoPath(p.id, p.revision, photo.key);
          return src ? [{ src, alt: photo.alt }] : [];
        })
      : [];
  const location =
    [p.location.area, p.location.town, p.location.county].filter(Boolean).join(', ') || p.locality;
  const family = p.type === 'bedsitter' || p.id === 'demo-kitengela-1' ? 'bedsitter' : 'studio';
  const gallery = [
    { file: 'room', label: 'Virtually staged main room' },
    { file: 'exterior', label: 'Proposed exterior' },
    { file: 'reverse', label: 'Virtually staged reverse view' },
    { file: 'kitchen', label: 'Kitchenette concept' },
    { file: 'bathroom', label: 'Bathroom concept' },
  ];
  const bedroomLabel =
    p.bedrooms === null
      ? 'Not applicable'
      : p.bedrooms === 0
        ? p.type === 'studio'
          ? 'Studio'
          : p.type === 'bedsitter'
            ? 'Bedsitter'
            : 'Open-plan'
        : String(p.bedrooms);
  return (
    <>
      <CatalogueBanner mode={mode} />
      <PublicHeader purpose={p.purpose} />
      <main id="main" tabIndex={-1} className="detail-page container">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href={p.purpose === 'rent' ? '/?purpose=rent' : '/?purpose=sale'}>
            {p.purpose === 'rent' ? 'Homes to rent' : 'Homes to buy'}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Property details</span>
        </nav>
        <p className="catalogue-source">
          {result.sourceLabel}
          {synthetic ? ' · Synthetic listing. No real availability.' : ''}
        </p>
        <div className="detail-heading">
          <div>
            <span className="purpose-badge">
              {p.purpose === 'rent' ? 'For rent' : 'For sale'}
              {synthetic ? ' · Sample listing' : ''}
            </span>
            <h1>{p.title}</h1>
            <p className="location">{location}</p>
          </div>
          <div className="detail-heading-price">
            <strong>{price}</strong>
            {p.rentalPeriod && <small> / {p.rentalPeriod}</small>}
            <PricingDisclosureSummary pricing={p.pricing} />
          </div>
        </div>
        {mode === 'demo' ? (
          <section aria-label="Illustrative AI concept gallery">
            <div className="detail-gallery">
              {gallery.slice(0, 3).map((photo, index) => (
                <div
                  key={photo.file}
                  className={'gallery-photo' + (index === 0 ? ' gallery-primary' : '')}
                >
                  <Image
                    src={'/demo/' + family + '-' + photo.file + '.jpg'}
                    alt={
                      'AI concept: ' +
                      photo.label.toLowerCase() +
                      '. Illustrative, not a photograph of this listing.'
                    }
                    fill
                    priority={index === 0}
                    sizes={
                      index === 0
                        ? '(max-width: 580px) 100vw, 66vw'
                        : '(max-width: 580px) 50vw, 33vw'
                    }
                  />
                  {index === 0 && (
                    <span className="gallery-photo-label">AI concept · illustrative</span>
                  )}
                </div>
              ))}
            </div>
            <div className="gallery-footer">
              <span>Generated concept images, reused across sample listings.</span>
              <span>Virtual staging · Proposed finish</span>
            </div>
            <details className="gallery-more">
              <summary>See all {gallery.length} concept images</summary>
              <div className="expanded-gallery">
                {gallery.map((photo) => (
                  <figure key={photo.file}>
                    <div className="gallery-photo">
                      <Image
                        src={'/demo/' + family + '-' + photo.file + '.jpg'}
                        alt={'Illustrative AI concept: ' + photo.label.toLowerCase()}
                        fill
                        sizes="(max-width: 800px) 50vw, 33vw"
                      />
                    </div>
                    <figcaption>{photo.label} · AI concept</figcaption>
                  </figure>
                ))}
              </div>
            </details>
          </section>
        ) : publicPhotos.length > 0 ? (
          <PublicPhotoGallery key={p.id + ':' + p.revision} photos={publicPhotos} />
        ) : (
          <section className="detail-photo-placeholder" aria-label="Property photos">
            <div className="placeholder-building" aria-hidden="true">
              ⌂
            </div>
            <h2>Property photos unavailable</h2>
            <p>
              Photos aren’t available in this preview. Explore the supplied details and costs below.
            </p>
          </section>
        )}
        <div className="detail-columns">
          <section className="detail-content" aria-labelledby="about-title">
            <h2 id="about-title">A space to make your own.</h2>
            {mode === 'connected' && (
              <p className="public-stock-status">
                Public catalogue status: available when this page was read, with agency confirmation
                within the last30days. Availability can change; confirm with the agency before
                travelling.{synthetic ? ' This is fictional test stock.' : ''}
              </p>
            )}
            <p>{p.description}</p>
            <div className="detail-specs">
              <div>
                <span>
                  <strong>{bedroomLabel}</strong>
                  <small>{p.bedrooms === 0 ? 'Open-plan room' : 'Bedrooms'}</small>
                </span>
              </div>
              <div>
                <span>
                  <strong>
                    {mode === 'demo'
                      ? (p.bathrooms ?? 'Not supplied')
                      : (p.privateBathrooms ?? 'Not supplied')}
                  </strong>
                  <small>{mode === 'demo' ? 'Bathrooms' : 'Private bathrooms'}</small>
                </span>
              </div>
              <div>
                <span>
                  <strong>{p.areaSqm === null ? 'Not supplied' : p.areaSqm + ' m²'}</strong>
                  <small>Floor area</small>
                </span>
              </div>
            </div>
            <h2>Property details</h2>
            <dl className="property-facts">
              <div>
                <dt>Property type</dt>
                <dd>{p.type}</dd>
              </div>
              <div>
                <dt>Purpose</dt>
                <dd>{p.purpose === 'rent' ? 'Rent' : 'Buy'}</dd>
              </div>
              <div>
                <dt>Area</dt>
                <dd>{p.location.area ?? 'Not supplied'}</dd>
              </div>
              <div>
                <dt>Town</dt>
                <dd>{p.location.town ?? 'Not supplied'}</dd>
              </div>
              <div>
                <dt>County</dt>
                <dd>{p.location.county ?? 'Not supplied'}</dd>
              </div>
              <div>
                <dt>Price period</dt>
                <dd>{p.rentalPeriod ?? 'One-off sale price'}</dd>
              </div>
              {mode === 'connected' && (
                <div>
                  <dt>Shared bathrooms</dt>
                  <dd>{p.sharedBathrooms ?? 'Not supplied'}</dd>
                </div>
              )}
              <div>
                <dt>Availability</dt>
                <dd>{synthetic ? 'Sample only' : 'Confirm with agency'}</dd>
              </div>
            </dl>
            <h2>Features &amp; amenities</h2>
            {p.amenitiesKnown && p.amenities.length === 0 ? (
              <p>No amenities have been listed.</p>
            ) : p.amenitiesKnown ? (
              <ul className="amenities">
                {p.reference?.attributes
                  ? p.reference.attributes.amenities.map((amenity) => (
                      <li key={amenity.id}>{amenity.label}</li>
                    ))
                  : p.amenities.map((amenity) => <li key={amenity}>{amenity}</li>)}
              </ul>
            ) : (
              <p>Amenities have not been supplied.</p>
            )}
            <div className="location-note">
              <h2>The neighbourhood</h2>
              <p>
                {location}.{' '}
                {p.publicPrecision === 'exact' && p.latitude !== null
                  ? 'A map is not available in this preview.'
                  : 'No exact address or map pin is shown.'}
              </p>
              {!p.location.area && !p.location.town && !p.location.county && (
                <p>Area, town and county have not been supplied separately.</p>
              )}
            </div>
          </section>
          <aside className="price-card" aria-label="Property costs and next steps">
            <PricingDisclosureCard pricing={p.pricing} preview={synthetic} />
            <div className="contact-preview">
              <h3>Like what you see?</h3>
              {propertyEnquiry ? (
                <>
                  <p>
                    Test an enquiry about this synthetic property. No messages or viewing bookings
                    are sent.
                  </p>
                  <Link href={'/enquire?property=' + encodeURIComponent(p.id)} className="primary">
                    Test a property enquiry →
                  </Link>
                </>
              ) : (
                <p>
                  Enquiries and viewing requests are disabled in this development preview. No
                  messages or bookings will be sent.
                </p>
              )}
            </div>
            <Link href="/" className="primary">
              Explore more properties →
            </Link>
          </aside>
        </div>
        <p className="detail-bottom-note">
          {synthetic
            ? 'This is a synthetic listing for development review. Its price, location and features do not represent an available property.'
            : 'Development preview. Confirm current availability and all payable costs with the agency before making a commitment.'}
        </p>
      </main>
      <PublicFooter mode={mode} />
    </>
  );
}
