import {
  validateStaffEnquiryQueueInputV3,
  type StaffEnquiryQueueInputV3,
} from '@realtor/api-client';

/** Detached query data only; no actor, company, origin or bearer can come from this input. */
export function enquiryQueueInput(input: unknown = {}): StaffEnquiryQueueInputV3 {
  const value = validateStaffEnquiryQueueInputV3(input);
  return Object.freeze({
    limit: value.limit,
    filter: value.filter,
    ...(value.after === null ? {} : { after: value.after }),
  });
}

export function enquiryQueueSearch(input: StaffEnquiryQueueInputV3 = {}) {
  const value = enquiryQueueInput(input);
  const query = new URLSearchParams({ limit: String(value.limit), filter: value.filter! });
  if (value.after !== undefined) query.set('after', value.after);
  return query.toString();
}

/** Exact, single-valued bounded query for the one new read-only BFF route. */
export function parseEnquiryQueueSearch(params: URLSearchParams): StaffEnquiryQueueInputV3 {
  if (new TextEncoder().encode(params.toString()).byteLength > 2048)
    throw new Error('Invalid enquiry queue query.');
  const value: Record<string, unknown> = {};
  for (const [key, raw] of params) {
    if (!['limit', 'filter', 'after'].includes(key) || Object.hasOwn(value, key) || raw === '')
      throw new Error('Invalid enquiry queue query.');
    if (key === 'limit') {
      if (!/^[1-9]\d{0,2}$/.test(raw)) throw new Error('Invalid enquiry queue limit.');
      value.limit = Number(raw);
    } else value[key] = raw;
  }
  return enquiryQueueInput(value);
}
