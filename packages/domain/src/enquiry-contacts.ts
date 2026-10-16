export type ContactChannel = 'call' | 'whatsapp' | 'email' | 'in_person' | 'other';
export type ContactOutcome =
  'connected' | 'no_response' | 'left_message' | 'wrong_contact' | 'other';
export interface ContactFacts {
  readonly channel: ContactChannel;
  readonly outcome: ContactOutcome;
  readonly occurredAt: string;
  readonly notes: string;
}
export interface ContactCommand extends ContactFacts {
  readonly operationId: string;
  readonly expectedVersion: string;
}
export interface ContactEntry extends ContactFacts {
  readonly entryId: string;
  readonly actorId: string;
  readonly recordedAt: string;
}
export type ContactReceipt = Readonly<{
  operationId: string;
  enquiryId: string;
  actorId: string;
  expectedVersion: string;
  observedVersion: string;
  request: ContactFacts;
  completedAt: string;
}> &
  (
    | Readonly<{ outcome: 'applied'; reason: null; entry: ContactEntry }>
    | Readonly<{ outcome: 'conflict'; reason: 'VERSION_CONFLICT'; entry: null }>
  );
export interface ContactPage {
  readonly items: readonly ContactEntry[];
  readonly limit: number;
  readonly truncated: boolean;
}
const fail = (): never => {
  throw new Error('Invalid contact log contract.');
};
function object(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    return fail();
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    result[key] = d.value;
  }
  return result;
}
function uuid(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
  )
    return fail();
  return v;
}
function version(v: unknown): string {
  if (typeof v !== 'string' || !/^[1-9]\d{0,15}$/.test(v) || BigInt(v) > 9007199254740991n)
    return fail();
  return v;
}
function time(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) ||
    v.startsWith('0000') ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString() !== v
  )
    return fail();
  return v;
}
const FACTS = ['channel', 'outcome', 'occurredAt', 'notes'] as const;
function facts(v: Record<string, unknown>): ContactFacts {
  if (
    typeof v.channel !== 'string' ||
    !['call', 'whatsapp', 'email', 'in_person', 'other'].includes(v.channel) ||
    typeof v.outcome !== 'string' ||
    !['connected', 'no_response', 'left_message', 'wrong_contact', 'other'].includes(v.outcome) ||
    typeof v.notes !== 'string' ||
    v.notes.trim().length === 0 ||
    [...v.notes].length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(v.notes)
  )
    return fail();
  return Object.freeze({
    channel: v.channel as ContactChannel,
    outcome: v.outcome as ContactOutcome,
    occurredAt: time(v.occurredAt),
    notes: v.notes,
  });
}
function same(a: ContactFacts, b: ContactFacts): boolean {
  return FACTS.every((k) => a[k] === b[k]);
}
export function validateContactCommand(input: unknown): ContactCommand {
  const v = object(input, ['operationId', 'expectedVersion', ...FACTS]);
  return Object.freeze({
    operationId: uuid(v.operationId),
    expectedVersion: version(v.expectedVersion),
    ...facts(v),
  });
}
function entry(input: unknown): ContactEntry {
  const v = object(input, ['entryId', 'actorId', 'recordedAt', ...FACTS]),
    f = facts(v),
    recordedAt = time(v.recordedAt);
  if (f.occurredAt > recordedAt) return fail();
  return Object.freeze({ entryId: uuid(v.entryId), actorId: uuid(v.actorId), recordedAt, ...f });
}
export function validateContactReceipt(
  input: unknown,
  enquiryId: string,
  operationId: string,
  original?: ContactCommand,
): ContactReceipt {
  const v = object(input, [
    'operationId',
    'enquiryId',
    'actorId',
    'expectedVersion',
    'observedVersion',
    'request',
    'outcome',
    'reason',
    'entry',
    'completedAt',
  ]);
  const id = uuid(v.operationId),
    enquiry = uuid(v.enquiryId),
    actorId = uuid(v.actorId),
    expectedVersion = version(v.expectedVersion),
    observedVersion = version(v.observedVersion),
    request = facts(object(v.request, FACTS)),
    completedAt = time(v.completedAt);
  if (id !== uuid(operationId) || enquiry !== uuid(enquiryId) || request.occurredAt > completedAt)
    return fail();
  if (original) {
    const command = validateContactCommand(original);
    if (
      command.operationId !== id ||
      command.expectedVersion !== expectedVersion ||
      !same(command, request)
    )
      return fail();
  }
  const base = {
    operationId: id,
    enquiryId: enquiry,
    actorId,
    expectedVersion,
    observedVersion,
    request,
    completedAt,
  };
  if (v.outcome === 'conflict') {
    if (v.reason !== 'VERSION_CONFLICT' || v.entry !== null || expectedVersion === observedVersion)
      return fail();
    return Object.freeze({ ...base, outcome: 'conflict', reason: 'VERSION_CONFLICT', entry: null });
  }
  if (v.outcome !== 'applied' || v.reason !== null || expectedVersion !== observedVersion)
    return fail();
  const result = entry(v.entry);
  if (
    result.entryId !== id ||
    result.actorId !== actorId ||
    result.recordedAt !== completedAt ||
    !same(result, request)
  )
    return fail();
  return Object.freeze({ ...base, outcome: 'applied', reason: null, entry: result });
}
export function validateContactPage(input: unknown, limit: number): ContactPage {
  const v = object(input, ['items', 'limit', 'truncated']);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    v.limit !== limit ||
    typeof v.truncated !== 'boolean' ||
    !Array.isArray(v.items) ||
    Object.getPrototypeOf(v.items) !== Array.prototype ||
    v.items.length > limit ||
    Reflect.ownKeys(v.items).length !== v.items.length + 1 ||
    (v.truncated && v.items.length !== limit)
  )
    return fail();
  const items: ContactEntry[] = [],
    ids = new Set<string>();
  for (let i = 0; i < v.items.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v.items, String(i));
    if (!d || !Object.hasOwn(d, 'value')) return fail();
    const current = entry(d.value),
      previous = items.at(-1);
    if (
      ids.has(current.entryId) ||
      (previous &&
        (previous.recordedAt < current.recordedAt ||
          (previous.recordedAt === current.recordedAt && previous.entryId >= current.entryId)))
    )
      return fail();
    ids.add(current.entryId);
    items.push(current);
  }
  return Object.freeze({ items: Object.freeze(items), limit, truncated: v.truncated });
}
