import { normalizeKenyanPhone } from '@realtor/domain';

export const MAX_PUBLIC_COMPANY_CONTENT_BYTES = 64 * 1024;
export const MAX_PUBLIC_ADVISORS = 20;
export type ConfiguredPublicAdvisor = Readonly<{
  id: string;
  name: string;
  role: string;
  bio: string;
}>;
export type PublicCompanyContent = Readonly<{
  policy: 'public-company-content-v1';
  companySlug: string;
  company: Readonly<{
    summary: string;
    about: string;
    officeAddress?: string;
    openingHours?: string;
  }>;
  advisors: readonly ConfiguredPublicAdvisor[];
  contact?: Readonly<{ email?: string; phone?: string; whatsapp?: true }>;
}>;
export type PublicCompanyContentResolution =
  | Readonly<{ status: 'absent' | 'invalid' }>
  | Readonly<{ status: 'configured'; content: PublicCompanyContent }>;

function invalid(): never {
  throw Error('Invalid public company content configuration.');
}
function record(input: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key)) ||
    required.some((key) => !Object.hasOwn(input, key))
  )
    return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return invalid();
    result[key] = field.value;
  }
  return result;
}
function text(input: unknown, maximum: number): string {
  if (
    typeof input !== 'string' ||
    !input.trim() ||
    input.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>\ud800-\udfff]/u.test(input)
  )
    return invalid();
  const normalized = input.trim().normalize('NFC');
  if (normalized.length > maximum) return invalid();
  return normalized;
}
function withinByteLimit(source: string) {
  if (
    source.length > MAX_PUBLIC_COMPANY_CONTENT_BYTES ||
    new TextEncoder().encode(source).byteLength > MAX_PUBLIC_COMPANY_CONTENT_BYTES
  )
    invalid();
}

/** Plain public data only. Validation does not prove publication approval, identity or consent. */
export function validatePublicCompanyContent(
  input: unknown,
  companySlug: string,
): PublicCompanyContent {
  if (
    typeof companySlug !== 'string' ||
    companySlug.length > 63 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(companySlug)
  )
    return invalid();
  const value = record(input, ['policy', 'companySlug', 'company', 'advisors'], ['contact']);
  if (value.policy !== 'public-company-content-v1' || value.companySlug !== companySlug)
    return invalid();
  const company = record(value.company, ['summary', 'about'], ['officeAddress', 'openingHours']);
  if (
    !Array.isArray(value.advisors) ||
    Object.getPrototypeOf(value.advisors) !== Array.prototype ||
    value.advisors.length > MAX_PUBLIC_ADVISORS
  )
    return invalid();
  const sourceAdvisors = value.advisors;
  if (Reflect.ownKeys(sourceAdvisors).length !== sourceAdvisors.length + 1) return invalid();
  const ids = new Set<string>();
  const advisors: ConfiguredPublicAdvisor[] = [];
  for (let index = 0; index < sourceAdvisors.length; index++) {
    const field = Object.getOwnPropertyDescriptor(sourceAdvisors, String(index));
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return invalid();
    const advisor = record(field.value, ['id', 'name', 'role', 'bio']);
    if (
      typeof advisor.id !== 'string' ||
      advisor.id.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(advisor.id) ||
      ids.has(advisor.id)
    )
      return invalid();
    ids.add(advisor.id);
    advisors.push(
      Object.freeze({
        id: advisor.id,
        name: text(advisor.name, 120),
        role: text(advisor.role, 160),
        bio: text(advisor.bio, 2000),
      }),
    );
  }
  let contact: PublicCompanyContent['contact'];
  if (Object.hasOwn(value, 'contact')) {
    const supplied = record(value.contact, [], ['email', 'phone', 'whatsapp']);
    let email: string | undefined, phone: string | undefined;
    if (Object.hasOwn(supplied, 'email')) {
      email = text(supplied.email, 254).toLowerCase();
      if (
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
          email,
        ) ||
        email.split('@')[0]!.length > 64
      )
        return invalid();
    }
    if (Object.hasOwn(supplied, 'phone')) phone = normalizeKenyanPhone(text(supplied.phone, 40));
    if (Object.hasOwn(supplied, 'whatsapp') && (supplied.whatsapp !== true || !phone))
      return invalid();
    contact = Object.freeze({
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(supplied.whatsapp === true ? { whatsapp: true as const } : {}),
    });
  }
  const result: PublicCompanyContent = Object.freeze({
    policy: 'public-company-content-v1',
    companySlug,
    company: Object.freeze({
      summary: text(company.summary, 240),
      about: text(company.about, 4000),
      ...(Object.hasOwn(company, 'officeAddress')
        ? { officeAddress: text(company.officeAddress, 300) }
        : {}),
      ...(Object.hasOwn(company, 'openingHours')
        ? { openingHours: text(company.openingHours, 300) }
        : {}),
    }),
    advisors: Object.freeze(advisors),
    ...(contact ? { contact } : {}),
  });
  withinByteLimit(JSON.stringify(result));
  return result;
}

/** Reject duplicate decoded JSON keys and excessive nesting before shape validation. */
function parseContentJson(source: string): unknown {
  withinByteLimit(source);
  const token =
    /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/y;
  const stack: ({ kind: 'object'; keys: Set<string> } | { kind: 'array' })[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/[ \t\r\n]/.test(source[offset]!)) {
      offset++;
      continue;
    }
    token.lastIndex = offset;
    const match = token.exec(source);
    if (!match) return invalid();
    const part = match[0];
    offset = token.lastIndex;
    if (part === '{' || part === '[') {
      if (stack.length >= 6) return invalid();
      stack.push(part === '{' ? { kind: 'object', keys: new Set() } : { kind: 'array' });
    } else if (part === '}' || part === ']') {
      const parent = stack.pop();
      if (!parent || parent.kind !== (part === '}' ? 'object' : 'array')) return invalid();
    } else if (part.startsWith('"') && stack.at(-1)?.kind === 'object') {
      let next = offset;
      while (/[ \t\r\n]/.test(source[next] ?? 'x')) next++;
      if (source[next] === ':') {
        const parent = stack.at(-1)!;
        if (parent.kind !== 'object') return invalid();
        const key: string = JSON.parse(part);
        if (parent.keys.has(key)) return invalid();
        parent.keys.add(key);
      }
    }
  }
  if (stack.length) return invalid();
  return JSON.parse(source);
}

/** Caller supplies trusted deployment environment text, never browser query/header values. */
export function resolvePublicCompanyContent(
  source: unknown,
  companySlug: string,
): PublicCompanyContentResolution {
  if (source === undefined) return Object.freeze({ status: 'absent' });
  try {
    if (typeof source !== 'string' || !source) return invalid();
    const content = validatePublicCompanyContent(parseContentJson(source), companySlug);
    return Object.freeze({ status: 'configured', content });
  } catch {
    return Object.freeze({ status: 'invalid' });
  }
}
