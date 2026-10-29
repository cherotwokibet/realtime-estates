import { validateBrandColors, type TenantBrandConfig } from './branding.js';

/** Exact JSON keys at every object level; escaped duplicates never silently override approval/version. */
export function parseCompanySettingsJson(source: string): unknown {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 256 * 1024)
    throw Error('Settings JSON too large.');
  const parsed: unknown = JSON.parse(source);
  const stack: (Set<string> | null)[] = [];
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '{') stack.push(new Set());
    else if (t === '[') stack.push(null);
    else if (t === '}' || t === ']') stack.pop();
    else if (t.startsWith('"') && tokens[i + 1] === ':') {
      const keys = stack.at(-1),
        key = JSON.parse(t) as string;
      if (!keys || keys.has(key)) throw Error('Duplicate settings JSON key.');
      keys.add(key);
    }
  }
  return parsed;
}

/** Public copy/palette only. Contacts, identity, domains, modules and secrets stay deployment-controlled. */
export interface CompanySettingsContent {
  readonly companyName: string;
  readonly summary: string;
  readonly about: string;
  readonly officeAddress: string | null;
  readonly openingHours: string | null;
  readonly colors: TenantBrandConfig['colors'];
}
export interface CompanySettingsCommand {
  readonly policy: 'company-settings-command-v1';
  readonly operationId: string;
  readonly expectedVersion: string;
  readonly content: CompanySettingsContent;
  readonly approval: 'approved-for-publication';
}
export interface CompanySettingsRecord {
  readonly version: string;
  readonly operationId: string;
  readonly actorId: string;
  readonly recordedAt: string;
  readonly request: CompanySettingsCommand;
}
export interface CompanySettingsState {
  readonly policy: 'company-settings-state-v1';
  readonly version: string;
  readonly current: CompanySettingsContent | null;
  readonly history: readonly CompanySettingsRecord[];
  readonly hasMore: boolean;
}
function invalid(): never {
  throw Error('Invalid company settings.');
}
function record(input: unknown, keys: readonly string[]) {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    result[k] = d.value;
  }
  return result;
}
function text(input: unknown, max: number): string {
  if (
    typeof input !== 'string' ||
    !input.trim() ||
    input !== input.trim() ||
    input !== input.normalize('NFC') ||
    [...input].length > max ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>\ud800-\udfff]/u.test(input)
  )
    return invalid();
  return input;
}
const uuid = (value: unknown): string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : invalid();
const version = (value: unknown, zero = false): string =>
  typeof value === 'string' &&
  (zero ? /^(?:0|[1-9]\d{0,15})$/ : /^[1-9]\d{0,15}$/).test(value) &&
  BigInt(value) <= 9007199254740991n
    ? value
    : invalid();
export function validateCompanySettingsContent(input: unknown): CompanySettingsContent {
  const c = record(input, [
    'companyName',
    'summary',
    'about',
    'officeAddress',
    'openingHours',
    'colors',
  ]);
  return Object.freeze({
    companyName: text(c.companyName, 160),
    summary: text(c.summary, 320),
    about: text(c.about, 4000),
    officeAddress: c.officeAddress === null ? null : text(c.officeAddress, 320),
    openingHours: c.openingHours === null ? null : text(c.openingHours, 320),
    colors: validateBrandColors(c.colors),
  });
}
export function validateCompanySettingsCommand(input: unknown): CompanySettingsCommand {
  const c = record(input, ['policy', 'operationId', 'expectedVersion', 'content', 'approval']);
  if (c.policy !== 'company-settings-command-v1' || c.approval !== 'approved-for-publication')
    return invalid();
  return Object.freeze({
    policy: c.policy,
    operationId: uuid(c.operationId),
    expectedVersion: version(c.expectedVersion, true),
    content: validateCompanySettingsContent(c.content),
    approval: c.approval,
  });
}
export function validateCompanySettingsRecord(input: unknown): CompanySettingsRecord {
  const r = record(input, ['version', 'operationId', 'actorId', 'recordedAt', 'request']);
  const request = validateCompanySettingsCommand(r.request),
    v = version(r.version),
    operationId = uuid(r.operationId);
  if (
    operationId !== request.operationId ||
    BigInt(v) !== BigInt(request.expectedVersion) + 1n ||
    typeof r.recordedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.recordedAt) ||
    !Number.isFinite(Date.parse(r.recordedAt)) ||
    new Date(r.recordedAt).toISOString() !== r.recordedAt
  )
    return invalid();
  return Object.freeze({
    version: v,
    operationId,
    actorId: uuid(r.actorId),
    recordedAt: r.recordedAt,
    request,
  });
}
export function validateCompanySettingsState(input: unknown): CompanySettingsState {
  const s = record(input, ['policy', 'version', 'current', 'history', 'hasMore']);
  if (
    s.policy !== 'company-settings-state-v1' ||
    typeof s.hasMore !== 'boolean' ||
    !Array.isArray(s.history) ||
    Object.getPrototypeOf(s.history) !== Array.prototype ||
    s.history.length > 20 ||
    Reflect.ownKeys(s.history).length !== s.history.length + 1
  )
    return invalid();
  const v = version(s.version, true),
    history: CompanySettingsRecord[] = [];
  for (let i = 0; i < s.history.length; i++) {
    const d = Object.getOwnPropertyDescriptor(s.history, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    const item = validateCompanySettingsRecord(d.value);
    if (BigInt(item.version) !== BigInt(v) - BigInt(i)) return invalid();
    history.push(item);
  }
  const current = s.current === null ? null : validateCompanySettingsContent(s.current);
  if (
    v === '0'
      ? current !== null || history.length !== 0 || s.hasMore
      : current === null ||
        history.length === 0 ||
        JSON.stringify(current) !== JSON.stringify(history[0]!.request.content) ||
        s.hasMore !== BigInt(v) > 20n ||
        history.length !== Math.min(Number(v), 20)
  )
    return invalid();
  return Object.freeze({
    policy: s.policy,
    version: v,
    current,
    history: Object.freeze(history),
    hasMore: s.hasMore,
  });
}
