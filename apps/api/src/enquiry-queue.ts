export type StaffEnquiryQueueFilter = 'all' | 'open' | 'overdue' | 'today';
export class EnquiryQueueInputError extends Error {
  constructor() {
    super('Use supported enquiry queue filters and pagination values.');
  }
}
/** Shared by the API and development HTTP allowlist; no caller-selected authority or SQL. */
export function staffEnquiryQueueQuery(params: URLSearchParams) {
  const fail = (): never => {
    throw new EnquiryQueueInputError();
  };
  if (new TextEncoder().encode(params.toString()).byteLength > 8192) fail();
  const q: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!['limit', 'filter', 'after'].includes(key) || Object.hasOwn(q, key)) fail();
    q[key] = value;
  }
  if (q.limit !== undefined && (!/^[1-9]\d{0,2}$/.test(q.limit) || Number(q.limit) > 100)) fail();
  if (q.filter !== undefined && !['all', 'open', 'overdue', 'today'].includes(q.filter)) fail();
  if (
    q.after !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(q.after)
  )
    fail();
  return Object.freeze({
    limit: q.limit === undefined ? 50 : Number(q.limit),
    filter: (q.filter ?? 'all') as StaffEnquiryQueueFilter,
    after: q.after ?? null,
  });
}
