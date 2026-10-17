'use client';
import { useEffect, useRef, useState } from 'react';
import {
  LISTING_IMPORT_COLUMNS,
  formatKes,
  kesFromMinor,
  type ListingImportPreview,
} from '@realtor/domain';
import { readListingImportPreview } from '../lib/listing-import-client';
const header = LISTING_IMPORT_COLUMNS.join(',') + '\r\n';
const sample =
  header +
  [
    'synthetic-import-flat',
    'Synthetic apartment',
    'Fictional inventory only',
    'rent',
    'apartment',
    '20000.05',
    'month',
    '2',
    '1',
    '',
    'KE',
    'Synthetic Nairobi',
    'area',
  ].join(',') +
  '\r\n';
export default function ListingImport({ instanceId }: { instanceId: string }) {
  const [csv, setCsv] = useState(''),
    [preview, setPreview] = useState<ListingImportPreview | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false);
  const generation = useRef(0),
    active = useRef<AbortController | null>(null),
    flight = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
      active.current?.abort();
    },
    [],
  );
  function clear() {
    generation.current++;
    active.current?.abort();
    active.current = null;
    flight.current = false;
    setBusy(false);
    setPreview(null);
    setMessage('');
    setError(false);
  }
  function edit(value: string) {
    clear();
    setCsv(value);
  }
  async function load(file: File | undefined) {
    clear();
    setCsv('');
    const epoch = generation.current;
    if (!file) return;
    if (file.size > 32768) {
      setError(true);
      setMessage('Choose a UTF-8 CSV file of at most 32 KiB.');
      return;
    }
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (epoch === generation.current) setCsv(value);
    } catch {
      if (epoch === generation.current) {
        setError(true);
        setMessage('The file must contain valid UTF-8 text.');
      }
    }
  }
  async function run() {
    if (flight.current) return;
    clear();
    const epoch = generation.current,
      controller = new AbortController();
    active.current = controller;
    flight.current = true;
    setBusy(true);
    try {
      const result = await readListingImportPreview(instanceId, csv, controller.signal);
      if (epoch === generation.current) {
        setPreview(result);
        setMessage('Current-company stock checked. No listings were created.');
      }
    } catch {
      if (epoch === generation.current) {
        setPreview(null);
        setError(true);
        setMessage(
          'Preview unavailable. Check the CSV header and limits, and current admin access, then try a fresh preview.',
        );
      }
    } finally {
      if (epoch === generation.current) {
        flight.current = false;
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section className="enq-contacts" aria-label="Listing CSV preview">
      <nav className="draft-breadcrumb">
        <a href="/listings">Listing work</a>
        <span aria-hidden="true">/</span>
        <span>CSV preview</span>
      </nav>
      <h1>Preview listing CSV</h1>
      <p>
        Check up to 100 listing records in a UTF-8 CSV of at most 32 KiB. Preview checks
        current-company slug collisions and row errors. It creates no listings and reserves no
        slugs.
      </p>
      <p>
        A valid row is a draft candidate. Photos, fees and publication requirements still need
        separate verification.
      </p>
      <div
        className="enq-actions"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '1rem 0' }}
      >
        <a
          className="enq-secondary"
          download="listing-import-template.csv"
          href="/listing-import-template.csv"
        >
          Download CSV template
        </a>
        <button
          className="enq-secondary"
          type="button"
          disabled={busy}
          onClick={() => edit(sample)}
        >
          Load synthetic sample
        </button>
      </div>
      <p>
        Use the exact template columns. Quote commas or line breaks inside fields. Prices use
        unformatted KES decimals; leave unknown optional facts empty.
      </p>
      <label style={{ display: 'block', margin: '1rem 0' }}>
        Choose CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => void load(event.target.files?.[0])}
        />
      </label>
      <label htmlFor="listing-import-csv" style={{ display: 'block', marginBottom: '0.5rem' }}>
        CSV text
      </label>
      <textarea
        id="listing-import-csv"
        rows={12}
        value={csv}
        disabled={busy}
        spellCheck={false}
        style={{ width: '100%', fontFamily: 'monospace' }}
        onChange={(event) => edit(event.target.value)}
      />
      <p>{new TextEncoder().encode(csv).byteLength.toLocaleString()} / 32,768 UTF-8 bytes</p>
      <div className="enq-actions">
        <button
          className="enq-primary"
          type="button"
          disabled={busy || !csv}
          onClick={() => void run()}
        >
          {busy ? 'Checking preview…' : 'Check CSV preview'}
        </button>
        {busy && (
          <button
            type="button"
            className="enq-secondary"
            onClick={() => {
              clear();
              setMessage('Preview cancelled.');
            }}
          >
            Cancel preview
          </button>
        )}
      </div>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
      {preview && (
        <section aria-label="CSV preview results">
          <h2>
            {preview.validRows} valid {preview.validRows === 1 ? 'row' : 'rows'} ·{' '}
            {preview.invalidRows} rows need correction
          </h2>
          <p>Record numbers include the header; quoted multiline fields remain one record.</p>
          <ol>
            {preview.rows.map((row) => (
              <li key={row.record}>
                <h3>
                  Record {row.record}: {row.slug ?? 'Invalid slug'}
                </h3>
                {row.issues.length ? (
                  <ul>
                    {row.issues.map((issue, index) => (
                      <li key={index}>
                        {issue.field}: {issue.message} ({issue.code})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Valid draft candidate · {row.content?.title ?? 'Title unknown'} ·{' '}
                    {row.content?.amountMinor === null
                      ? 'Price unknown'
                      : formatKes(kesFromMinor(row.content!.amountMinor!))}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
