import Image from 'next/image';
import Link from 'next/link';
import { formatKes, kesFromMajor, kesFromMinor } from '@realtor/domain';
import { loadCatalogue } from '../lib/catalogue-server';
import {
  CatalogueBanner,
  CatalogueProblem,
  ConnectedPublicHeader as PublicHeader,
  ConnectedPublicFooter as PublicFooter,
} from '../components/ConnectedPublicShell';
import { PricingDisclosureSummary } from '../components/PricingDisclosure';
import RoomFilters from '../components/RoomFilters';
import PriceFilters from '../components/PriceFilters';
import ReferenceFilters from '../components/ReferenceFilters';
import SearchAreaField from '../components/SearchAreaField';
import { parseReferenceFilters, referenceOptions } from '../lib/catalogue-reference-filters';
import LoadedCataloguePager from '../components/LoadedCataloguePager';
import { additionalActiveFilterLabels, browseCatalogue } from '../lib/catalogue-browse';
import { resolveSearchAreaMapPreview } from '../lib/search-area-editor';
import { publicPageMetadata } from '../lib/public-seo';
import { publicSeoPolicy } from '../lib/public-seo-server';
import { approvedPresentation, readApprovedCompany } from '../lib/approved-company';

export const dynamic = 'force-dynamic';

type Query = Record<string, string | string[] | undefined>;
export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  return publicPageMetadata(
    publicSeoPolicy,
    approvedPresentation(await readApprovedCompany()).brand.name,
    '/',
    'Find your next place',
    publicSeoPolicy.index
      ? 'Browse property details and itemized prices.'
      : 'Synthetic development preview. No real availability.',
    Object.keys(query).length === 0,
  );
}
function Icon({ kind }: { kind: 'pin' | 'search' | 'bed' | 'bath' | 'area' | 'arrow' }) {
  const paths = {
    pin: (
      <>
        <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    bed: <path d="M3 18v-8m18 8v-8M3 15h18M5 10V6h14v4M3 10h18v5M7 10V8h4v2m2 0V8h4v2" />,
    bath: (
      <path d="M3 12h18m-16 0V5a2 2 0 0 1 4 0m-5 7v3a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5v-3M7 20v2m10-2v2" />
    ),
    area: <path d="M4 10V4h6m4 0h6v6m0 4v6h-6m-4 0H4v-6M4 4l5 5m11-5-5 5M4 20l5-5m11 5-5-5" />,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}
function conceptPhoto(id: string, type: string) {
  if (type === 'bedsitter') return '/demo/bedsitter-room.jpg';
  if (type === 'studio') return '/demo/studio-room.jpg';
  return id === 'demo-kitengela-1' ? '/demo/bedsitter-exterior.jpg' : '/demo/studio-exterior.jpg';
}
const bathCount = (value: number | null, kind: string) =>
  value === null
    ? kind + ' baths not supplied'
    : value + ' ' + kind.toLowerCase() + ' ' + (value === 1 ? 'bath' : 'baths');

export default async function Home({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const catalogue = await loadCatalogue(q);
  const mapPreview = resolveSearchAreaMapPreview(process.env);
  const {
    location,
    area,
    purpose,
    type,
    period,
    minText,
    minMode,
    maxText,
    bedsText,
    bedsMode,
    privateBathsText,
    sharedBathsText,
    reference,
    error: filterError,
  } = catalogue.filters;
  const browse = browseCatalogue(catalogue, q);
  const error = filterError ?? browse.error;
  const properties = browse.items;
  const mode = catalogue.mode === 'error' ? 'unavailable' : catalogue.mode;
  const synthetic = catalogue.mode !== 'error' && catalogue.dataKind === 'synthetic';
  const money = (n: number) => formatKes(kesFromMinor(n));
  const filtered =
    Boolean(
      location ||
      area ||
      purpose ||
      type ||
      period ||
      minText ||
      minMode ||
      maxText ||
      bedsText ||
      bedsMode ||
      privateBathsText ||
      sharedBathsText,
    ) || Object.values(reference).some(Boolean);
  // Associate the current single search error with its actual field, rather than marking every filter invalid.
  const errorFields: readonly string[] =
    error === 'Choose one supported location or amenity option per field.'
      ? parseReferenceFilters(q).invalid
      : error === 'Use one value for each search filter.'
        ? [
            'location',
            'purpose',
            'type',
            'period',
            'min',
            'minMode',
            'max',
            'beds',
            'bedsMode',
            'privateBaths',
            'sharedBaths',
          ].filter((key) => q[key] !== undefined && typeof q[key] !== 'string')
        : browse.error && !filterError
          ? browse.errorField === 'sort'
            ? ['sort']
            : []
          : error === 'Choose rent or buy.' ||
              error === 'Choose rent or buy before filtering by price.'
            ? ['purpose']
            : error === 'Choose a supported property type.'
              ? ['type']
              : error === 'Choose a supported rental period.' ||
                  error === 'Choose a rental period when filtering rent by price.'
                ? ['period']
                : error === 'Minimum price must not exceed maximum price.'
                  ? ['min', 'max']
                  : error === 'Choose a supported minimum price comparison.'
                    ? ['minMode']
                    : error === 'Enter a positive minimum price to use Over.'
                      ? ['min', 'minMode']
                      : error === 'Enter a positive minimum price in KES.' ||
                          error ===
                            'Enter a valid minimum KES amount with at most two decimal places.'
                        ? ['min']
                        : error === 'Enter a positive maximum price in KES.' ||
                            error === 'Enter a valid KES amount with at most two decimal places.'
                          ? ['max']
                          : error === 'Choose a bedroom count from 0 to 100.'
                            ? ['beds']
                            : error === 'Choose a supported bedroom comparison.'
                              ? ['bedsMode']
                              : error === 'Enter a bedroom count to use At least.'
                                ? ['beds', 'bedsMode']
                                : error === 'Choose a minimum private bathroom count from 0 to 100.'
                                  ? ['privateBaths']
                                  : error ===
                                      'Choose a minimum shared bathroom count from 0 to 100.'
                                    ? ['sharedBaths']
                                    : [];
  const validation = (field: string) =>
    errorFields.includes(field)
      ? { 'aria-invalid': true as const, 'aria-describedby': 'search-error' }
      : {};
  return (
    <>
      <CatalogueBanner mode={mode} />
      <PublicHeader purpose={purpose} />
      <main id="main" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <Image
            src="/demo/studio-exterior.jpg"
            alt="Illustrative AI concept of a residential building; not a photograph of an available property."
            fill
            priority
            sizes="100vw"
            className="hero-image"
          />
          <div className="hero-shade" />
          <div className="hero-copy container">
            <div className="hero-eyebrow">
              <span />
              NAIROBI &amp; BEYOND
            </div>
            <h1 id="hero-title">
              Find a place
              <br />
              that feels like home.
            </h1>
            <p>
              A new chapter starts with the right space.
              <br className="desktop-break" /> Explore homes to rent and buy, with the details that
              matter.
            </p>
            <a className="hero-link" href="#search">
              Start your search <Icon kind="arrow" />
            </a>
          </div>
          <span className="hero-disclosure">AI concept image · illustrative</span>
        </section>
        <section
          className="search-wrap container"
          id="search"
          tabIndex={-1}
          aria-labelledby="search-title"
        >
          <form
            key={JSON.stringify([
              location,
              q.area,
              purpose,
              type,
              period,
              minText,
              minMode,
              maxText,
              bedsText,
              bedsMode,
              privateBathsText,
              sharedBathsText,
              error,
              browse.sort,
              reference,
            ])}
            action="/"
            className="search-panel"
            aria-describedby={error && !errorFields.length ? 'search-error' : undefined}
          >
            <div className="search-top">
              <h2 id="search-title">What are you looking for?</h2>
              <fieldset className="purpose-tabs" {...validation('purpose')}>
                <legend className="sr-only">Looking to rent or buy</legend>
                {[
                  { value: '', label: 'All properties' },
                  { value: 'rent', label: 'Rent' },
                  { value: 'sale', label: 'Buy' },
                ].map((option) => (
                  <label key={option.label}>
                    <input
                      type="radio"
                      name="purpose"
                      value={option.value}
                      defaultChecked={purpose === option.value}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="search-form">
              <label className="search-field">
                <span>Location</span>
                <div>
                  <Icon kind="pin" />
                  <input
                    name="location"
                    defaultValue={location}
                    placeholder="Neighbourhood or county"
                    autoComplete="off"
                    {...validation('location')}
                  />
                </div>
              </label>
              <label className="search-field">
                <span>Property type</span>
                <select name="type" defaultValue={type} {...validation('type')}>
                  <option value="">All property types</option>
                  {[
                    'apartment',
                    'bedsitter',
                    'studio',
                    'bungalow',
                    'maisonette',
                    'townhouse',
                    'villa',
                    'commercial',
                    'land',
                  ].map((t) => (
                    <option key={t} value={t}>
                      {t[0]?.toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="search-field">
                <span>Rental period</span>
                <select name="period" defaultValue={period} {...validation('period')}>
                  <option value="">All rental periods</option>
                  {['day', 'week', 'month', 'year'].map((value) => (
                    <option value={value} key={value}>
                      Per {value}
                    </option>
                  ))}
                </select>
              </label>
              <PriceFilters
                minText={minText}
                minMode={minMode}
                maxText={maxText}
                errorFields={errorFields}
              />
              <button className="primary search-button" type="submit">
                <Icon kind="search" />
                Search properties
              </button>
            </div>
            <RoomFilters
              bedsText={bedsText}
              bedsMode={bedsMode}
              privateBathsText={privateBathsText}
              sharedBathsText={sharedBathsText}
              errorFields={errorFields}
            />
            <SearchAreaField
              supported={catalogue.mode === 'connected' && catalogue.searchPage !== undefined}
              invalid={filterError === 'Choose one valid search area.'}
              value={typeof q.area === 'string' ? q.area : area ? JSON.stringify(area) : ''}
              filters={catalogue.filters}
              sort={browse.sort}
              tileUrl={mapPreview.tileUrl}
              syntheticGrid={mapPreview.syntheticGrid}
            />
            <ReferenceFilters
              scope={catalogue.mode === 'error' ? undefined : catalogue.referenceOptionsScope}
              values={reference}
              options={
                catalogue.mode === 'error' ? referenceOptions([]) : catalogue.referenceOptions
              }
              invalid={parseReferenceFilters(q).invalid}
            />
            <label className="search-field browse-sort">
              <span>
                {browse.scope === 'catalogue' ? 'Order search results' : 'Order loaded results'}
              </span>
              <select name="sort" defaultValue={browse.sort} {...validation('sort')}>
                <option value="catalogue">Catalogue order</option>
                <option value="title">Title</option>
                <option value="price_low">Base price: low to high</option>
                <option value="price_high">Base price: high to low</option>
              </select>
            </label>
            <p className="search-help">
              At least includes the minimum price; Over excludes an equal price. Maximum price is
              inclusive. Prices use the stated rental period and base price. Additional costs appear
              in each property’s details.
            </p>
            {error && (
              <p role="alert" id="search-error" className="error">
                {error}
              </p>
            )}
          </form>
        </section>
        <section
          className="collection container"
          id="properties"
          aria-labelledby="collection-title"
        >
          <div className="section-head">
            <div>
              <div className="eyebrow">YOUR NEXT CHAPTER</div>
              <h2 id="collection-title">
                {purpose === 'rent'
                  ? 'Spaces to call home.'
                  : purpose === 'sale'
                    ? 'A place to make your own.'
                    : 'Find your kind of place.'}
              </h2>
              <p>Thoughtful details. Clear prices. Room to imagine what comes next.</p>
            </div>
            <div className="results-summary">
              <span>
                {catalogue.mode === 'error'
                  ? 'Results unavailable'
                  : browse.matchingLoadedCount +
                    ' ' +
                    (synthetic ? 'sample ' : '') +
                    (browse.matchingLoadedCount === 1
                      ? browse.scope === 'catalogue'
                        ? 'matching property'
                        : 'matching loaded property'
                      : browse.scope === 'catalogue'
                        ? 'matching properties'
                        : 'matching loaded properties')}
              </span>
              {filtered && <Link href="/">Clear filters</Link>}
            </div>
          </div>
          {catalogue.mode !== 'error' && (
            <p className="catalogue-source">
              {catalogue.sourceLabel}
              {synthetic ? ' · Synthetic listings for testing; no real availability.' : ''}
              {browse.scope === 'catalogue'
                ? ' · Search covers matching public properties. Results may change between pages; traversal is limited to offset 10,000.'
                : ''}
              {catalogue.mayBeTruncated
                ? ' · Showing a limited selection of up to ' +
                  catalogue.limit +
                  ' properties. Search filters apply to this selection.'
                : ''}
            </p>
          )}
          {filtered && !error && (
            <div className="active-filters" aria-label="Current search filters">
              {location && (
                <span>
                  <Icon kind="pin" />
                  {location}
                </span>
              )}
              {purpose && <span>{purpose === 'rent' ? 'For rent' : 'For sale'}</span>}
              {type && <span>{type[0]?.toUpperCase() + type.slice(1)}</span>}
              {period && purpose !== 'sale' && <span>Rent per {period}</span>}
              {bedsText && (
                <span>
                  Bedrooms: {bedsMode === 'at_least' ? bedsText + '+' : 'exactly ' + bedsText}
                </span>
              )}
              {additionalActiveFilterLabels(
                catalogue.filters,
                catalogue.mode === 'error' ? referenceOptions([]) : catalogue.referenceOptions,
              ).map((label) => (
                <span key={label}>{label}</span>
              ))}
              {minText && (
                <span>
                  Base price {minMode === 'over' ? 'over' : 'from'}{' '}
                  {formatKes(kesFromMajor(minText))}
                  {purpose !== 'sale' && period
                    ? ' / rental ' + period + '; sale prices one-off'
                    : ''}
                </span>
              )}
              {maxText && (
                <span>
                  Base price up to {formatKes(kesFromMajor(maxText))}
                  {purpose !== 'sale' && period
                    ? ' / rental ' + period + '; sale prices one-off'
                    : ''}
                </span>
              )}
            </div>
          )}
          {catalogue.mode === 'error' ? (
            <CatalogueProblem message={catalogue.message} />
          ) : error ? (
            <div className="empty">
              <h3>Check your search filters.</h3>
              <p>Correct the highlighted fields to search again.</p>
            </div>
          ) : browse.outOfRange ? (
            <div className="empty">
              <h3>
                Choose an available {browse.scope === 'catalogue' ? 'search' : 'loaded'} page.
              </h3>
              <p>
                This page is outside the current{' '}
                {browse.scope === 'catalogue' ? 'search results' : 'loaded selection'}. Return to
                its first page.
              </p>
            </div>
          ) : properties.length ? (
            <div className="property-grid">
              {properties.map((p) => (
                <article className="property-card" key={p.id}>
                  <Link
                    href={'/properties/' + p.id}
                    prefetch={false}
                    className="property-photo"
                    aria-label={'View ' + p.title}
                  >
                    {mode === 'demo' ? (
                      <>
                        <Image
                          src={conceptPhoto(p.id, p.type)}
                          alt="Illustrative AI property concept, reused for sample listings; not a photograph of this property."
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 33vw"
                        />
                        <span className="image-disclosure">AI concept · illustrative</span>
                      </>
                    ) : (
                      <div className="photo-placeholder">
                        <Icon kind="area" />
                        <span>Property photos unavailable</span>
                        <small>Details and costs below</small>
                      </div>
                    )}
                    <span className="purpose-badge">
                      {p.purpose === 'rent' ? 'For rent' : 'For sale'}
                    </span>
                  </Link>
                  <div className="property-body">
                    <p className="location">
                      <Icon kind="pin" />
                      {[p.location.area, p.location.town, p.location.county]
                        .filter(Boolean)
                        .join(', ') || p.locality}
                    </p>
                    <h3>
                      <Link href={'/properties/' + p.id} prefetch={false}>
                        {p.title}
                      </Link>
                    </h3>
                    <p className="property-type">{p.type[0]?.toUpperCase() + p.type.slice(1)}</p>
                    <div className="specs">
                      <span>
                        <Icon kind="bed" />
                        {p.bedrooms === null
                          ? 'Bedrooms not applicable'
                          : p.bedrooms === 0
                            ? p.type === 'studio'
                              ? 'Studio'
                              : p.type === 'bedsitter'
                                ? 'Bedsitter'
                                : 'Open-plan'
                            : p.bedrooms + ' beds'}
                      </span>
                      <span>
                        <Icon kind="bath" />
                        {mode === 'demo'
                          ? p.bathrooms === null
                            ? 'Bathrooms not supplied'
                            : p.bathrooms + ' ' + (p.bathrooms === 1 ? 'bath' : 'baths')
                          : bathCount(p.privateBathrooms, 'Private') +
                            ' · ' +
                            bathCount(p.sharedBathrooms, 'Shared')}
                      </span>
                      <span>
                        <Icon kind="area" />
                        {p.areaSqm === null ? 'Floor area not supplied' : p.areaSqm + ' m²'}
                      </span>
                    </div>
                    <div className="price-row">
                      <div>
                        <strong>
                          {money(p.priceMinor)}
                          {p.rentalPeriod && <small> / {p.rentalPeriod}</small>}
                        </strong>
                        <PricingDisclosureSummary pricing={p.pricing} />
                      </div>
                      <Link
                        href={'/properties/' + p.id}
                        prefetch={false}
                        className="card-arrow"
                        aria-label={'Details for ' + p.title}
                      >
                        <Icon kind="arrow" />
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">
              <span className="empty-icon">
                <Icon kind="search" />
              </span>
              <h3>
                {filtered
                  ? 'No properties match your search.'
                  : 'No properties are available in this preview.'}
              </h3>
              <p>
                {catalogue.mayBeTruncated
                  ? 'Try another filter. This search covers a limited selection; more properties may exist.'
                  : filtered
                    ? 'Try another neighbourhood, property type or budget.'
                    : 'Check back later for newly published properties.'}
              </p>
              {filtered && (
                <Link className="primary" href="/">
                  Reset search <Icon kind="arrow" />
                </Link>
              )}
            </div>
          )}
          {catalogue.mode !== 'error' && !error && (
            <LoadedCataloguePager browse={browse} filters={catalogue.filters} />
          )}
        </section>
        <section className="approach" id="how" tabIndex={-1}>
          <div className="container">
            <div className="approach-heading">
              <div>
                <div className="eyebrow">A CLEARER WAY HOME</div>
                <h2>
                  A little less searching.
                  <br />A little more possibility.
                </h2>
              </div>
              <p>
                Start with the essentials, explore the details,
                <br />
                and feel ready for your next step.
              </p>
            </div>
            <ol className="approach-grid">
              <li>
                <span className="step-number">01</span>
                <h3>Find your fit</h3>
                <p>
                  Narrow your search by location, property type and budget. Your priorities come
                  first.
                </p>
              </li>
              <li>
                <span className="step-number">02</span>
                <h3>See the whole picture</h3>
                <p>
                  Explore layouts, amenities and exact base prices, with additional fees clearly
                  identified.
                </p>
              </li>
              <li>
                <span className="step-number">03</span>
                <h3>Take the next step</h3>
                <p>
                  Enquiries and viewing requests will connect you with the agency when those
                  services launch.
                </p>
              </li>
            </ol>
          </div>
        </section>
      </main>
      <PublicFooter mode={mode} />
    </>
  );
}
