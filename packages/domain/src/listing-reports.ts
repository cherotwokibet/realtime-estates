import { parseListingSuccessorJsonV2 } from './listing-json-v2.js';
/** Anonymous reports contain no reporter account/contact and grant no publication authority. */
export const LISTING_REPORT_REASONS = [
  'suspected_fraud',
  'wrong_price',
  'unavailable',
  'other',
] as const;
export type ListingReportReason = (typeof LISTING_REPORT_REASONS)[number];
export interface ListingReportCommand {
  readonly policy: 'listing-report-command-v1';
  readonly operationId: string;
  readonly listingId: string;
  readonly reason: ListingReportReason;
  readonly details: string | null;
}
export interface ListingReportReceipt {
  readonly policy: 'listing-report-receipt-v1';
  readonly operationId: string;
  readonly listingId: string;
  readonly status: 'recorded';
  readonly recordedAt: string;
}
export interface ListingReportDecisionCommand {
  readonly policy: 'listing-report-decision-command-v1';
  readonly operationId: string;
  readonly reportId: string;
  readonly expectedVersion: string;
  readonly decision: 'reviewed' | 'dismissed';
  readonly reason: string;
}
export interface ListingReportDecisionReceipt {
  readonly policy: 'listing-report-decision-receipt-v1';
  readonly operationId: string;
  readonly reportId: string;
  readonly version: string;
  readonly decision: 'reviewed' | 'dismissed';
  readonly reason: string;
  readonly actorId: string;
  readonly recordedAt: string;
}
export interface ListingReportAdminRecord {
  readonly reportId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly reason: ListingReportReason;
  readonly details: string | null;
  readonly noticeVersion: string;
  readonly recordedAt: string;
  readonly version: string;
  readonly status: 'new' | 'reviewed' | 'dismissed';
  readonly decision: null | {
    readonly kind: 'reviewed' | 'dismissed';
    readonly reason: string;
    readonly actorId: string;
    readonly recordedAt: string;
  };
}
export interface ListingReportQueue {
  readonly policy: 'listing-report-queue-v1';
  readonly items: readonly ListingReportAdminRecord[];
  readonly hasMore: boolean;
  readonly limit: number;
  readonly status: 'all' | 'new' | 'reviewed' | 'dismissed';
}
const invalid = (): never => {
  throw Error('Invalid listing report.');
};
/** Bounded exact-key JSON, including escaped duplicates and canonical numeric queue tokens. */
export function parseListingReportJson(source: string): unknown {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 524288)
    return invalid();
  const parsed = parseListingSuccessorJsonV2(source),
    stack: (Set<string> | null)[] = [];
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(token) as string,
        keys = stack.at(-1);
      if (!keys || keys.has(key)) return invalid();
      keys.add(key);
      if (['limit', 'revision'].includes(key) && !/^[1-9]\d*$/.test(tokens[i + 2] ?? ''))
        return invalid();
    }
  }
  return parsed;
}
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    return invalid();
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    output[key] = d.value;
  }
  return output;
}
const uuid = (value: unknown): string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : invalid();
function plain(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value !== value.normalize('NFC') ||
    [...value].length > max ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>\ud800-\udfff]/u.test(value)
  )
    return invalid();
  return value;
}
const version = (value: unknown): string =>
  typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) && BigInt(value) <= 9007199254740991n
    ? value
    : invalid();
const instant = (value: unknown): string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value
    ? value
    : invalid();
export function validateListingReportCommand(input: unknown): ListingReportCommand {
  const r = record(input, ['policy', 'operationId', 'listingId', 'reason', 'details']);
  if (
    r.policy !== 'listing-report-command-v1' ||
    !LISTING_REPORT_REASONS.includes(r.reason as ListingReportReason)
  )
    return invalid();
  return Object.freeze({
    policy: r.policy,
    operationId: uuid(r.operationId),
    listingId: uuid(r.listingId),
    reason: r.reason as ListingReportReason,
    details: r.details === null ? null : plain(r.details, 1200),
  });
}
/** Exact minimal acknowledgment only; never accept report text, reporter identity or triage facts. */
export function validateListingReportReceipt(
  input: unknown,
  command?: Pick<ListingReportCommand, 'operationId' | 'listingId'>,
): ListingReportReceipt {
  const r = record(input, ['policy', 'operationId', 'listingId', 'status', 'recordedAt']);
  if (r.policy !== 'listing-report-receipt-v1' || r.status !== 'recorded') return invalid();
  const value = Object.freeze({
    policy: r.policy,
    operationId: uuid(r.operationId),
    listingId: uuid(r.listingId),
    status: r.status,
    recordedAt: instant(r.recordedAt),
  });
  if (
    command &&
    (value.operationId !== command.operationId || value.listingId !== command.listingId)
  )
    return invalid();
  return value;
}
export function validateListingReportDecisionCommand(input: unknown): ListingReportDecisionCommand {
  const r = record(input, [
    'policy',
    'operationId',
    'reportId',
    'expectedVersion',
    'decision',
    'reason',
  ]);
  if (
    r.policy !== 'listing-report-decision-command-v1' ||
    !['reviewed', 'dismissed'].includes(r.decision as string)
  )
    return invalid();
  const expectedVersion = version(r.expectedVersion);
  if (BigInt(expectedVersion) >= 9007199254740991n) return invalid();
  return Object.freeze({
    policy: r.policy,
    operationId: uuid(r.operationId),
    reportId: uuid(r.reportId),
    expectedVersion,
    decision: r.decision as 'reviewed' | 'dismissed',
    reason: plain(r.reason, 500),
  });
}
export function validateListingReportDecisionReceipt(
  input: unknown,
  command?: ListingReportDecisionCommand,
): ListingReportDecisionReceipt {
  const r = record(input, [
    'policy',
    'operationId',
    'reportId',
    'version',
    'decision',
    'reason',
    'actorId',
    'recordedAt',
  ]);
  if (
    r.policy !== 'listing-report-decision-receipt-v1' ||
    !['reviewed', 'dismissed'].includes(r.decision as string)
  )
    return invalid();
  const value = Object.freeze({
    policy: r.policy,
    operationId: uuid(r.operationId),
    reportId: uuid(r.reportId),
    version: version(r.version),
    decision: r.decision as 'reviewed' | 'dismissed',
    reason: plain(r.reason, 500),
    actorId: uuid(r.actorId),
    recordedAt: instant(r.recordedAt),
  });
  if (
    command &&
    (value.operationId !== command.operationId ||
      value.reportId !== command.reportId ||
      value.version !== (BigInt(command.expectedVersion) + 1n).toString() ||
      value.decision !== command.decision ||
      value.reason !== command.reason)
  )
    return invalid();
  return value;
}
export function validateListingReportAdminRecord(input: unknown): ListingReportAdminRecord {
  const r = record(input, [
    'reportId',
    'listingId',
    'revision',
    'reason',
    'details',
    'noticeVersion',
    'recordedAt',
    'version',
    'status',
    'decision',
  ]);
  if (
    !Number.isSafeInteger(r.revision) ||
    Number(r.revision) < 1 ||
    Number(r.revision) > 2147483647 ||
    !LISTING_REPORT_REASONS.includes(r.reason as ListingReportReason) ||
    !['new', 'reviewed', 'dismissed'].includes(r.status as string) ||
    typeof r.noticeVersion !== 'string' ||
    !/^[a-z0-9][-a-z0-9.]{0,119}$/.test(r.noticeVersion)
  )
    return invalid();
  let decision: ListingReportAdminRecord['decision'] = null;
  if (r.decision !== null) {
    const d = record(r.decision, ['kind', 'reason', 'actorId', 'recordedAt']);
    if (d.kind !== r.status || !['reviewed', 'dismissed'].includes(d.kind as string))
      return invalid();
    decision = Object.freeze({
      kind: d.kind as 'reviewed' | 'dismissed',
      reason: plain(d.reason, 500),
      actorId: uuid(d.actorId),
      recordedAt: instant(d.recordedAt),
    });
  }
  const recordedAt = instant(r.recordedAt);
  if (
    (r.status === 'new' && (r.version !== '1' || decision !== null)) ||
    (r.status !== 'new' && (r.version !== '2' || decision === null)) ||
    (decision && decision.recordedAt < recordedAt)
  )
    return invalid();
  return Object.freeze({
    reportId: uuid(r.reportId),
    listingId: uuid(r.listingId),
    revision: Number(r.revision),
    reason: r.reason as ListingReportReason,
    details: r.details === null ? null : plain(r.details, 1200),
    noticeVersion: r.noticeVersion,
    recordedAt,
    version: version(r.version),
    status: r.status as ListingReportAdminRecord['status'],
    decision,
  });
}
export function validateListingReportQueue(
  input: unknown,
  expected?: Pick<ListingReportQueue, 'limit' | 'status'>,
): ListingReportQueue {
  const r = record(input, ['policy', 'items', 'hasMore', 'limit', 'status']);
  if (
    r.policy !== 'listing-report-queue-v1' ||
    !Array.isArray(r.items) ||
    typeof r.hasMore !== 'boolean' ||
    !Number.isSafeInteger(r.limit) ||
    Number(r.limit) < 1 ||
    Number(r.limit) > 50 ||
    r.items.length > Number(r.limit) ||
    !['all', 'new', 'reviewed', 'dismissed'].includes(r.status as string) ||
    (r.hasMore && r.items.length !== r.limit)
  )
    return invalid();
  if (expected && (r.limit !== expected.limit || r.status !== expected.status)) return invalid();
  const items = r.items.map(validateListingReportAdminRecord);
  if (
    new Set(items.map((i) => i.reportId)).size !== items.length ||
    items.some(
      (item, i) =>
        (r.status !== 'all' && item.status !== r.status) ||
        (i > 0 &&
          (items[i - 1]!.recordedAt < item.recordedAt ||
            (items[i - 1]!.recordedAt === item.recordedAt &&
              items[i - 1]!.reportId <= item.reportId))),
    )
  )
    return invalid();
  return Object.freeze({
    policy: r.policy,
    items: Object.freeze(items),
    hasMore: r.hasMore,
    limit: Number(r.limit),
    status: r.status as ListingReportQueue['status'],
  });
}
