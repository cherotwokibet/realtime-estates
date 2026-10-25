import type {
  EnquiryOperationInputV2,
  EnquiryOperationKindV2,
  StaffEnquiryDetailV2,
  StaffEnquirySummaryV2,
  StaffEnquiryStatusV2,
} from '@realtor/api-client';

export type EnquiryAction =
  'assign' | 'contact' | 'qualify' | 'close_won' | 'close_lost' | 'spam' | 'reopen' | 'reschedule';
export interface EnquiryForm {
  action: EnquiryAction;
  assignedAgentId: string;
  nextActionLocal: string;
  reason: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES: readonly StaffEnquiryStatusV2[] = [
  'new',
  'assigned',
  'contacted',
  'qualified',
  'closed_won',
  'closed_lost',
  'spam',
];
const OPEN: readonly StaffEnquiryStatusV2[] = ['new', 'assigned', 'contacted', 'qualified'];
const EAT_OFFSET = 3 * 60 * 60 * 1000;
const fail = (message: string): never => {
  throw new Error(message);
};
function own(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail('Use ordinary enquiry fields.');
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return fail('Supply exactly the required enquiry fields.');
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const value = Object.getOwnPropertyDescriptor(input, key);
    if (!value?.enumerable || !Object.hasOwn(value, 'value'))
      return fail('Use own enquiry values without accessors.');
    result[key] = value.value;
  }
  return result;
}
const uuid = (input: unknown): string =>
  typeof input === 'string' && UUID.test(input)
    ? input.toLowerCase()
    : fail('Choose a valid enquiry or staff identifier.');
function version(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(input) ||
    BigInt(input) > 9007199254740990n
  )
    return fail('This saved version cannot accept another operation. Read the current enquiry.');
  return input;
}
function utc(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input) ||
    !Number.isFinite(Date.parse(input)) ||
    new Date(input).toISOString() !== input
  )
    return fail('Use a valid UTC date with millisecond precision.');
  return input;
}
function reason(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input !== input.trim() ||
    input.length === 0 ||
    [...input].length > 1000 ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(input)
  )
    return fail('Supply a reason of 1–1,000 characters without line breaks or control characters.');
  return input;
}
export function enquiryActionLabel(action: EnquiryAction): string {
  return {
    assign: 'Assign staff member',
    contact: 'Record contact',
    qualify: 'Mark qualified',
    close_won: 'Close as won',
    close_lost: 'Close as lost',
    spam: 'Mark as spam',
    reopen: 'Reopen enquiry',
    reschedule: 'Reschedule follow-up',
  }[action];
}
export function enquiryStatusLabel(status: StaffEnquiryStatusV2): string {
  return {
    new: 'New',
    assigned: 'Assigned',
    contacted: 'Contacted',
    qualified: 'Qualified',
    closed_won: 'Closed · won',
    closed_lost: 'Closed · lost',
    spam: 'Spam',
  }[status];
}
/** UI lifecycle guidance after an authorized read, never a permission or membership check. */
export function allowedEnquiryActions(
  detail: StaffEnquiryDetailV2,
  role: 'admin' | 'agent',
): readonly EnquiryAction[] {
  if ((role !== 'admin' && role !== 'agent') || !STATUSES.includes(detail.status))
    return fail('The current enquiry role or state is unavailable.');
  const result: EnquiryAction[] = [];
  if (detail.status === 'new' && role === 'admin') result.push('assign');
  if (detail.status === 'assigned') result.push('contact');
  if (detail.status === 'contacted') result.push('qualify', 'reschedule');
  if (detail.status === 'qualified') result.push('close_won', 'reschedule');
  if (OPEN.includes(detail.status)) result.push('close_lost', 'spam');
  else result.push('reopen');
  if (role === 'admin' && detail.status !== 'new') result.push('assign');
  return Object.freeze(result);
}
/** EAT is explicitly fixed UTC+03:00; browser-local date parsing is never used. */
export function toNairobiInput(value: string | null): string {
  if (value === null) return '';
  const shifted = new Date(Date.parse(utc(value)) + EAT_OFFSET).toISOString();
  if (!/^(?!0000)\d{4}-/.test(shifted))
    return fail('The Nairobi follow-up date is outside years 0001–9999.');
  return shifted.slice(0, -1);
}
export function fromNairobiInput(value: string): string {
  if (typeof value !== 'string') return fail('Choose a Nairobi date and time.');
  const match =
    /^(?!0000)(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return fail('Choose a valid Nairobi date and time (EAT, UTC+03:00).');
  const [year, month, day, hour, minute, second, millisecond] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? '0'),
    Number((match[7] ?? '0').padEnd(3, '0')),
  ];
  const civil = new Date(0);
  civil.setUTCFullYear(year!, month! - 1, day!);
  civil.setUTCHours(hour!, minute!, second!, millisecond!);
  if (
    civil.getUTCFullYear() !== year ||
    civil.getUTCMonth() !== month! - 1 ||
    civil.getUTCDate() !== day ||
    civil.getUTCHours() !== hour ||
    civil.getUTCMinutes() !== minute ||
    civil.getUTCSeconds() !== second ||
    civil.getUTCMilliseconds() !== millisecond
  )
    return fail('Choose a real calendar date and time.');
  const result = new Date(civil.getTime() - EAT_OFFSET).toISOString();
  return utc(result);
}
export function formatEnquiryTime(value: string | null): string {
  if (value === null) return 'Not scheduled';
  const local = toNairobiInput(value),
    date = new Date(local + 'Z');
  return (
    new Intl.DateTimeFormat('en-KE', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date) + ' EAT (UTC+03:00)'
  );
}
export function enquiryDueLabel(value: string | null, now: number = Date.now()): string {
  if (value === null) return 'No follow-up scheduled';
  if (!Number.isFinite(now)) return fail('Current time is unavailable.');
  const due = Date.parse(utc(value));
  if (due < now) return 'Overdue';
  const day = (instant: number) => new Date(instant + EAT_OFFSET).toISOString().slice(0, 10);
  if (day(due) === day(now)) return 'Due today';
  if (day(due) === day(now + 24 * 60 * 60 * 1000)) return 'Due tomorrow';
  return 'Upcoming';
}
/** In-app reminders over an already authorized loaded slice; no new reads or notifications. */
export function enquiryFollowUps(items: readonly StaffEnquirySummaryV2[], now: number) {
  if (!Number.isFinite(now)) return fail('Current time is unavailable.');
  const active = items
    .filter((item) => OPEN.includes(item.status) && item.nextActionAt !== null)
    .map((item) => ({ item, due: Date.parse(utc(item.nextActionAt)) }))
    .sort((a, b) => a.due - b.due || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  return Object.freeze({
    overdue: Object.freeze(active.filter(({ due }) => due < now).map(({ item }) => item)),
    today: Object.freeze(
      active
        .filter(
          ({ item, due }) => due >= now && enquiryDueLabel(item.nextActionAt, now) === 'Due today',
        )
        .map(({ item }) => item),
    ),
  });
}
export function enquiryForm(detail: StaffEnquiryDetailV2, role: 'admin' | 'agent'): EnquiryForm {
  return {
    action: allowedEnquiryActions(detail, role)[0]!,
    assignedAgentId: detail.assignedAgentId ?? '',
    nextActionLocal: toNairobiInput(detail.nextActionAt),
    reason: '',
  };
}
export function enquiryFormsEqual(left: EnquiryForm, right: EnquiryForm): boolean {
  return (
    left.action === right.action &&
    left.assignedAgentId === right.assignedAgentId &&
    left.nextActionLocal === right.nextActionLocal &&
    left.reason === right.reason
  );
}
/** Snapshot all seven fields. Nothing is inferred from a future/current read. */
export function validateEnquiryCommand(input: unknown): EnquiryOperationInputV2 {
  const value = own(input, [
    'operationId',
    'kind',
    'expectedVersion',
    'assignedAgentId',
    'status',
    'nextActionAt',
    'reason',
  ]);
  if (!['assign', 'transition', 'reschedule'].includes(value.kind as string))
    return fail('Choose an enquiry operation.');
  const kind = value.kind as EnquiryOperationKindV2,
    assignedAgentId = value.assignedAgentId === null ? null : uuid(value.assignedAgentId),
    status =
      value.status === null
        ? null
        : STATUSES.includes(value.status as StaffEnquiryStatusV2)
          ? (value.status as StaffEnquiryStatusV2)
          : fail('Choose a supported enquiry status.'),
    nextActionAt = value.nextActionAt === null ? null : utc(value.nextActionAt),
    why = value.reason === null ? null : reason(value.reason);
  if (
    kind === 'assign'
      ? assignedAgentId === null || status !== null || nextActionAt !== null || why !== null
      : kind === 'reschedule'
        ? assignedAgentId !== null || status !== null || nextActionAt === null || why !== null
        : assignedAgentId !== null ||
          status === null ||
          ['contacted', 'qualified'].includes(status) !== (nextActionAt !== null) ||
          ['new', 'assigned', 'closed_lost', 'spam'].includes(status) !== (why !== null)
  )
    return fail('Supply the required fields for this operation; unused values must be null.');
  return Object.freeze({
    operationId: uuid(value.operationId),
    kind,
    expectedVersion: version(value.expectedVersion),
    assignedAgentId,
    status,
    nextActionAt,
    reason: why,
  });
}
export function createEnquiryCommand(
  detail: StaffEnquiryDetailV2,
  input: EnquiryForm,
  operationId: string,
  role: 'admin' | 'agent',
): EnquiryOperationInputV2 {
  const form = own(input, ['action', 'assignedAgentId', 'nextActionLocal', 'reason']);
  if (!allowedEnquiryActions(detail, role).includes(form.action as EnquiryAction))
    return fail('This action is unavailable for the saved enquiry. Compare the current version.');
  if (
    typeof form.assignedAgentId !== 'string' ||
    typeof form.nextActionLocal !== 'string' ||
    typeof form.reason !== 'string'
  )
    return fail('Keep the enquiry form values as text.');
  const action = form.action as EnquiryAction,
    kind: EnquiryOperationKindV2 =
      action === 'assign' ? 'assign' : action === 'reschedule' ? 'reschedule' : 'transition';
  const target: StaffEnquiryStatusV2 | null =
    action === 'contact'
      ? 'contacted'
      : action === 'qualify'
        ? 'qualified'
        : action === 'close_won'
          ? 'closed_won'
          : action === 'close_lost'
            ? 'closed_lost'
            : action === 'spam'
              ? 'spam'
              : action === 'reopen'
                ? detail.assignedAgentId === null
                  ? 'new'
                  : 'assigned'
                : null;
  return validateEnquiryCommand({
    operationId,
    kind,
    expectedVersion: detail.version,
    assignedAgentId: kind === 'assign' ? form.assignedAgentId : null,
    status: target,
    nextActionAt:
      kind === 'reschedule' || target === 'contacted' || target === 'qualified'
        ? fromNairobiInput(form.nextActionLocal)
        : null,
    reason:
      target !== null && ['new', 'assigned', 'closed_lost', 'spam'].includes(target)
        ? form.reason.trim()
        : null,
  });
}
