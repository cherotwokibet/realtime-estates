import { DomainError } from './errors.js';
import { kesFromMajor } from './money.js';
import { normalizeStaffDraftContentV2, type StaffDraftContentV2 } from './staff-draft-content.js';

export const LISTING_IMPORT_COLUMNS = Object.freeze([
  'slug',
  'title',
  'description',
  'purpose',
  'propertyType',
  'priceKes',
  'rentPeriod',
  'bedrooms',
  'privateBathrooms',
  'sharedBathrooms',
  'country',
  'locality',
  'publicPrecision',
] as const);
export interface ListingImportIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}
export interface ListingImportRow {
  /** CSV record number including the header, not a physical line number. */
  readonly record: number;
  readonly slug: string | null;
  readonly content: StaffDraftContentV2 | null;
  readonly issues: readonly ListingImportIssue[];
}
export interface ListingImportPreview {
  readonly kind: 'listing_import_preview';
  readonly existingStockChecked: boolean;
  readonly rows: readonly ListingImportRow[];
  readonly validRows: number;
  readonly invalidRows: number;
}
const invalid = (message: string): never => {
  throw new DomainError('INVALID_LISTING_IMPORT', message);
};
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Strict bounded RFC4180-style comma records, CRLF or LF, no delimiter guessing. */
function records(csv: string): string[][] {
  if (
    typeof csv !== 'string' ||
    csv.length > 32768 ||
    new TextEncoder().encode(csv).byteLength > 32768 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(csv) ||
    /[\uD800-\uDFFF]/u.test(csv)
  )
    return invalid('Use a UTF-8 CSV file of at most32KiB.');
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const out: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field);
    field = '';
    closed = false;
    if (row.length > 64) return invalid('Too many columns in a CSV record.');
  };
  const record = () => {
    cell();
    out.push(row);
    row = [];
    if (out.length > 101) return invalid('Preview at most100 listing records at once.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field !== '' || closed) return invalid('A CSV quote must start a field.');
      quoted = true;
      continue;
    }
    if (c === ',') {
      cell();
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r') {
        if (text[i + 1] !== '\n') return invalid('Use CRLF or LF record separators.');
        i++;
      }
      record();
      continue;
    }
    if (closed) return invalid('Unexpected text after a quoted CSV field.');
    field += c;
  }
  if (quoted) return invalid('A quoted CSV field is not closed.');
  if (field !== '' || row.length || closed) record();
  if (out.length < 2) return invalid('Include the exact header and at least one listing record.');
  const header = out[0]!;
  if (
    header.length !== LISTING_IMPORT_COLUMNS.length ||
    new Set(header).size !== header.length ||
    header.some(
      (name) => !LISTING_IMPORT_COLUMNS.includes(name as (typeof LISTING_IMPORT_COLUMNS)[number]),
    )
  )
    return invalid(
      'Use the supplied import columns exactly; duplicate or unknown columns are not accepted.',
    );
  return out;
}
/** Pure preview. Existing slugs must come from a separately authorized server read.
 * This creates no identity, reservation, upload, draft, publication or operation. */
export function previewListingImport(
  csv: string,
  existingSlugs: readonly string[] = [],
  existingStockChecked = false,
): ListingImportPreview {
  const length = Object.getOwnPropertyDescriptor(existingSlugs, 'length')?.value;
  if (
    !Array.isArray(existingSlugs) ||
    Object.getPrototypeOf(existingSlugs) !== Array.prototype ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > 100 ||
    Reflect.ownKeys(existingSlugs).length !== length + 1 ||
    typeof existingStockChecked !== 'boolean'
  )
    return invalid('Invalid existing-stock comparison.');
  const existing = new Set<string>();
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(existingSlugs, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      return invalid('Invalid existing-stock comparison.');
    const value = descriptor.value;
    if (typeof value !== 'string' || value.length > 160 || !slugPattern.test(value))
      return invalid('Invalid existing-stock comparison.');
    existing.add(value);
  }
  if (!existingStockChecked && existing.size)
    return invalid('Existing stock must be explicitly checked.');
  const parsed = records(csv),
    header = parsed.shift()!,
    counts = new Map<string, number>();
  const raw = parsed.map((cells) => {
    const fields: Record<string, string> = {};
    header.forEach((key, i) => {
      fields[key] = cells[i] ?? '';
    });
    if (
      cells.length === header.length &&
      fields.slug &&
      fields.slug.length <= 160 &&
      slugPattern.test(fields.slug)
    )
      counts.set(fields.slug, (counts.get(fields.slug) ?? 0) + 1);
    return { cells, fields };
  });
  const rows = raw.map(({ cells, fields }, index): ListingImportRow => {
    const issues: ListingImportIssue[] = [];
    const issue = (field: string, code: string, message: string) =>
      issues.push(Object.freeze({ field, code, message }));
    let slug: string | null = null,
      content: StaffDraftContentV2 | null = null;
    if (cells.length !== header.length)
      issue('record', 'COLUMN_COUNT', 'Use one value for every header column.');
    if (!fields.slug || fields.slug.length > 160 || !slugPattern.test(fields.slug))
      issue(
        'slug',
        'INVALID_SLUG',
        'Use1–160 lowercase letters, digits and single separating hyphens.',
      );
    else {
      slug = fields.slug;
      if ((counts.get(slug) ?? 0) > 1)
        issue('slug', 'DUPLICATE_IN_FILE', 'This slug appears more than once in the file.');
      if (existing.has(slug))
        issue('slug', 'EXISTING_SLUG', 'This slug already exists in the current company.');
    }
    const nullable = (key: string) => (fields[key] === '' ? null : fields[key]);
    const number = (key: string) => {
      const value = fields[key];
      if (value === '') return null;
      if (!value || !/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
        issue(key, 'INVALID_INTEGER', 'Use a whole number or leave unknown values empty.');
        return null;
      }
      return Number(value);
    };
    let amountMinor: number | null = null;
    if (fields.priceKes !== '') {
      try {
        amountMinor = kesFromMajor(fields.priceKes!).minorUnits;
      } catch {
        issue(
          'priceKes',
          'INVALID_PRICE',
          'Use an unformatted KES amount with at most two decimals.',
        );
      }
    }
    const candidate = {
      title: nullable('title'),
      description: nullable('description'),
      purpose: nullable('purpose'),
      propertyType: nullable('propertyType'),
      currency: 'KES',
      amountMinor,
      rentPeriod: nullable('rentPeriod'),
      bedrooms: number('bedrooms'),
      privateBathrooms: number('privateBathrooms'),
      sharedBathrooms: number('sharedBathrooms'),
      country: fields.country,
      locality: nullable('locality'),
      publicPrecision: fields.publicPrecision,
      latitude: null,
      longitude: null,
      privateAddress: null,
      pricing: { declaration: 'not_declared', charges: [] },
      location: { county: null, town: null, area: null },
    };
    try {
      content = normalizeStaffDraftContentV2(candidate);
    } catch (error) {
      issue(
        'content',
        'INVALID_DRAFT',
        error instanceof DomainError ? error.message : 'Review the draft fields.',
      );
    }
    if (issues.length) content = null;
    return Object.freeze({ record: index + 2, slug, content, issues: Object.freeze(issues) });
  });
  const validRows = rows.filter((row) => row.issues.length === 0).length;
  return Object.freeze({
    kind: 'listing_import_preview',
    existingStockChecked,
    rows: Object.freeze(rows),
    validRows,
    invalidRows: rows.length - validRows,
  });
}
