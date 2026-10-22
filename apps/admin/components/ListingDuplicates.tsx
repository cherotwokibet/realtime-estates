'use client';
import { useEffect, useRef, useState } from 'react';
import type { ListingDuplicateCandidates, StaffListingSummary } from '@realtor/domain';
import { readListingDuplicateCandidates } from '../lib/listing-duplicates-client';

export default function ListingDuplicates({
  listing,
  instanceId,
}: {
  listing: StaffListingSummary;
  instanceId: string;
}) {
  const [result, setResult] = useState<ListingDuplicateCandidates | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      'Check the latest working revision against current company stock.',
    );
  const flight = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      flight.current?.abort();
    },
    [],
  );
  async function check() {
    if (flight.current || !listing.latest) return;
    const controller = new AbortController(),
      ticket = ++generation.current;
    flight.current = controller;
    setBusy(true);
    setResult(null);
    setMessage('Checking possible matches…');
    try {
      const found = await readListingDuplicateCandidates(
        instanceId,
        {
          listingId: listing.listingId,
          listingVersion: listing.version,
          revision: listing.latest.revision,
          revisionVersion: listing.latest.version,
          limit: 20,
        },
        controller.signal,
      );
      if (ticket !== generation.current || controller.signal.aborted) return;
      setResult(found);
      setMessage('Lookup finished. Review suggestions against fresh listing details.');
    } catch {
      if (ticket === generation.current) {
        setResult(null);
        setMessage(
          'Lookup unavailable, cancelled or stale. Reload this listing before checking again.',
        );
      }
    } finally {
      if (ticket === generation.current) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    generation.current++;
    flight.current?.abort();
    flight.current = null;
    setBusy(false);
    setResult(null);
    setMessage('Lookup cancelled. No result retained.');
  }
  return (
    <section className="enq-contacts duplicate-review" aria-labelledby="duplicate-heading">
      <a href="/listings">← Listing queue</a>
      <h1 id="duplicate-heading">Review possible duplicate listings</h1>
      <h2>{listing.latest?.title ?? listing.slug}</h2>
      <p>
        Reference: {listing.slug}. Listing version {listing.version}; working revision{' '}
        {listing.latest?.revision ?? 'unavailable'}.
      </p>
      <p>
        Suggestions compare title, locality, purpose and property type in latest working revisions.
        Different units may match; spelling or Unicode differences may be missed. This check cannot
        prove that a listing is unique.
      </p>
      <p>No records are merged, archived or changed by this check.</p>
      {listing.latest && (
        <a href={`/drafts/${listing.listingId}/${listing.latest.revision}`}>
          Read current revision details
        </a>
      )}
      <div className="duplicate-actions">
        <button
          className="enq-primary"
          type="button"
          disabled={busy || !listing.latest}
          onClick={() => void check()}
        >
          Check possible matches
        </button>
        {busy && (
          <button className="enq-secondary" type="button" onClick={cancel}>
            Cancel lookup
          </button>
        )}
        <a className="enq-secondary" href={`/listings/${listing.listingId}/duplicates`}>
          Reload current listing
        </a>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {result && (
        <div aria-label="Possible match results">
          {result.comparison === 'insufficient_facts' ? (
            <p>
              There are not enough title, locality, purpose or property-type facts to compare this
              revision. No uniqueness conclusion is available.
            </p>
          ) : result.matches.length === 0 ? (
            <p>
              No possible matches were returned by this limited comparison. This does not establish
              uniqueness.
            </p>
          ) : (
            <>
              <h2>
                {result.matches.length} possible {result.matches.length === 1 ? 'match' : 'matches'}
              </h2>
              <ul>
                {result.matches.map((match) => (
                  <li key={match.listingId}>
                    <a href={`/listings/${match.listingId}/duplicates`}>
                      Read current details for {match.slug}
                    </a>
                    <p>
                      Revision {match.revision} · {match.revisionState} · {match.availability} ·{' '}
                      {match.publicationStatus}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.hasMore && (
            <p>
              More possible matches exist. Only the first20 are shown; this is not an exhaustive
              result.
            </p>
          )}
          <p>
            These facts may change after the lookup. Follow a link to load current candidate details
            before making any decision.
          </p>
        </div>
      )}
    </section>
  );
}
