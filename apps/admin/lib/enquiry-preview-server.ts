import {
  validateViewingReminderAdmissionCommand,
  validateViewingReminderCaptureCommand,
  type ViewingReminderAdmissionCommand,
  type ViewingReminderCaptureCommand,
} from '@realtor/api-client';
import {
  validateViewingOutcomeCommand,
  validateViewingOutcomeReceipt,
  type ViewingOutcomeCommand,
  type ViewingOutcomeKind,
  type ViewingOutcomeReceipt,
} from '@realtor/api-client';
import {
  validateViewingRescheduleCommand,
  type ViewingRescheduleCommand,
} from '@realtor/api-client';
import { validateViewingProperties } from './viewing-properties.ts';
import 'server-only';
import {
  validateViewingTerminationCommand,
  type ViewingTerminationCommand,
  validateViewingConfirmationCommand,
  type ViewingConfirmationCommand,
  validateViewingOriginal,
  type ViewingOriginal,
  type ViewingReceipt,
} from '@realtor/api-client';
import {
  validateContactCommand,
  type ContactCommand,
  handleSyntheticEnquiry,
  ApiClientError,
  RealtorApiClient,
  type EnquiryOperationInputV2,
} from '@realtor/api-client';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
import { parseEnquiryQueueSearch } from './enquiry-queue.ts';

type Actor = 'admin' | 'agent';
type Action =
  | 'reminder-admit'
  | 'reminder-admit-recover'
  | 'reminder-capture'
  | 'reminder-capture-recover'
  | 'viewing-complete'
  | 'viewing-complete-recover'
  | 'viewing-no-show'
  | 'viewing-no-show-recover'
  | 'viewing-reschedule'
  | 'viewing-reschedule-recover'
  | 'viewing-history'
  | 'viewing-cancel'
  | 'viewing-cancel-recover'
  | 'viewing-decline'
  | 'viewing-decline-recover'
  | 'viewing-confirm'
  | 'viewing-confirm-recover'
  | 'viewing-properties'
  | 'list'
  | 'queue'
  | 'detail'
  | 'assignees'
  | 'command'
  | 'operation'
  | 'activity'
  | 'contacts'
  | 'contact-record'
  | 'contact-recover'
  | 'viewing-list'
  | 'viewing-detail'
  | 'viewing-request'
  | 'viewing-propose'
  | 'viewing-recover';
type Params = {
  actor: string;
  id?: string;
  operationId?: string;
  viewingId?: string;
  admissionOperationId?: string;
};
type Environment = Readonly<Record<string, string | undefined>>;
type Scope = Readonly<{ actorId: string; role: Actor; instanceId: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8192,
  BODY_TIMEOUT_MS = 15000;
const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const MESSAGE = 'The synthetic enquiry preview request could not be completed.';
const reply = (status: number, code: string, submissionUncertain = false) =>
  Response.json(
    { error: { code, message: MESSAGE }, submissionUncertain },
    { status, headers: HEADERS },
  );
class BoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function configuration(actor: unknown, env: Environment) {
  if (
    (actor !== 'admin' && actor !== 'agent') ||
    env.NODE_ENV !== 'development' ||
    env.STAFF_ENQUIRY_PREVIEW_MODE !== 'synthetic-v1'
  )
    throw new Error('Unavailable synthetic scope.');
  const origin = new URL(env.STAFF_PREVIEW_API_ORIGIN ?? '');
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error('Invalid local origin.');
  const scopes = Object.fromEntries(
    (['admin', 'agent'] as const).map((role) => {
      const prefix = `STAFF_ENQUIRY_${role.toUpperCase()}`,
        bearerToken = env[`${prefix}_TOKEN`],
        actorId = env[`${prefix}_ID`],
        instanceId = env[`${prefix}_INSTANCE`];
      if (
        !bearerToken ||
        bearerToken.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearerToken) ||
        !actorId ||
        !UUID.test(actorId) ||
        !instanceId ||
        !UUID.test(instanceId)
      )
        throw new Error('Unavailable synthetic identity.');
      return [
        role,
        Object.freeze({
          role,
          actorId: actorId.toLowerCase(),
          instanceId: instanceId.toLowerCase(),
          bearerToken,
        }),
      ];
    }),
  ) as Record<Actor, Scope & Readonly<{ bearerToken: string }>>;
  if (
    scopes.admin.actorId === scopes.agent.actorId ||
    scopes.admin.instanceId === scopes.agent.instanceId ||
    scopes.admin.bearerToken === scopes.agent.bearerToken
  )
    throw new Error('Synthetic roles must have separate fixed scopes.');
  return Object.freeze({ ...scopes[actor], origin: origin.origin });
}

/** Safe page metadata only. These fixed development roles never select a production identity. */
export function getEnquiryPreviewScope(actor: unknown, env: Environment = process.env): Scope {
  const { actorId, role, instanceId } = configuration(actor, env);
  return Object.freeze({ actorId, role, instanceId });
}

/** Local synthetic server read only; no bearer token is returned to the page. */
export async function loadOperationsPreview(env: Environment = process.env) {
  const config =
    env.STAFF_ENQUIRY_PREVIEW_MODE === 'synthetic-v1'
      ? configuration('admin', env)
      : previewConfiguration(env);
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-operations-preview-v1',
    allowLoopbackHttp: true,
  });
  return client.getStaffOperationsOverview({ bearerToken: config.bearerToken, timeoutMs: 5000 });
}

function failure(error: unknown, writeDispatched: boolean): Response {
  if (error instanceof BoundaryError) return reply(error.status, error.code);
  if (!(error instanceof ApiClientError)) return reply(502, 'PREVIEW_UNAVAILABLE', writeDispatched);
  const uncertain = writeDispatched && error.submissionUncertain;
  if (error.kind === 'CANCELLED') return reply(499, 'CANCELLED', uncertain);
  if (error.kind === 'TIMEOUT') return reply(504, 'PREVIEW_UNAVAILABLE', uncertain);
  if (error.kind === 'VALIDATION') return reply(400, 'INVALID_INPUT');
  if (error.kind === 'HTTP') {
    const codes: Readonly<Record<number, readonly string[]>> = {
      400: ['INVALID_INPUT', 'INVALID_JSON'],
      401: ['UNAUTHENTICATED'],
      403: ['FORBIDDEN'],
      404: ['NOT_FOUND'],
      405: ['METHOD_NOT_ALLOWED'],
      409: ['CONFLICT'],
      413: ['BODY_TOO_LARGE'],
      415: ['JSON_REQUIRED'],
      422: ['INVALID_STATE'],
      429: ['RATE_LIMITED'],
      503: ['SERVICE_UNAVAILABLE'],
    };
    if (error.status !== undefined && codes[error.status]?.includes(error.serverCode ?? ''))
      return reply(error.status, error.serverCode!, uncertain);
  }
  return reply(502, 'PREVIEW_UNAVAILABLE', uncertain);
}

function requestShape(request: Request, params: Params, action: Action): number | undefined {
  const contact = action === 'contact-record' || action === 'contact-recover',
    viewingBody = [
      'viewing-complete',
      'viewing-complete-recover',
      'viewing-no-show',
      'viewing-no-show-recover',
      'viewing-request',
      'viewing-propose',
      'viewing-recover',
      'viewing-confirm',
      'viewing-confirm-recover',
      'viewing-reschedule',
      'viewing-reschedule-recover',
      'viewing-cancel',
      'viewing-cancel-recover',
      'viewing-decline',
      'viewing-decline-recover',
    ].includes(action),
    bodyAction = action === 'command' || contact || viewingBody || action.startsWith('reminder-');
  const url = new URL(request.url),
    base = `/api/enquiry-preview/${params.actor}`;
  if (
    url.hash ||
    request.url.includes('#') ||
    [params.id, params.operationId, params.viewingId, params.admissionOperationId].some(
      (value) => value !== undefined && !UUID.test(value),
    )
  )
    throw new BoundaryError(400, 'INVALID_INPUT');
  const terminal = [
    'viewing-cancel',
    'viewing-cancel-recover',
    'viewing-decline',
    'viewing-decline-recover',
  ].includes(action);
  const outcome = action.startsWith('viewing-complete') || action.startsWith('viewing-no-show');
  const reminderAdmit = action === 'reminder-admit' || action === 'reminder-admit-recover',
    reminderCapture = action === 'reminder-capture' || action === 'reminder-capture-recover';
  if (reminderCapture ? !params.admissionOperationId : params.admissionOperationId !== undefined)
    throw new BoundaryError(400, 'INVALID_INPUT');
  const path =
    action === 'queue'
      ? `${base}/queue`
      : reminderAdmit
        ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}/reminder-admissions${action.endsWith('-recover') ? '/recover' : ''}`
        : reminderCapture
          ? `${base}/enquiries/${params.id}/viewing-reminder-admissions/${params.admissionOperationId}/captures${action.endsWith('-recover') ? '/recover' : ''}`
          : outcome
            ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}/${action.startsWith('viewing-complete') ? 'completions' : 'no-shows'}${action.endsWith('-recover') ? '/recover' : ''}`
            : action === 'viewing-reschedule' || action === 'viewing-reschedule-recover'
              ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}/reschedules${action.endsWith('-recover') ? '/recover' : ''}`
              : action === 'viewing-history'
                ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}/history`
                : terminal
                  ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}/${action.startsWith('viewing-cancel') ? 'cancellations' : 'declines'}${action.endsWith('-recover') ? '/recover' : ''}`
                  : action === 'viewing-confirm' || action === 'viewing-confirm-recover'
                    ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}/confirmations${action === 'viewing-confirm-recover' ? '/recover' : ''}`
                    : action === 'viewing-properties'
                      ? `${base}/viewing-properties`
                      : action === 'list'
                        ? `${base}/enquiries`
                        : action === 'assignees'
                          ? `${base}/assignees`
                          : action === 'viewing-list' || action === 'viewing-request'
                            ? `${base}/enquiries/${params.id}/viewings`
                            : action === 'viewing-detail'
                              ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}`
                              : action === 'viewing-propose'
                                ? `${base}/enquiries/${params.id}/viewings/${params.viewingId}/proposals`
                                : action === 'viewing-recover'
                                  ? `${base}/enquiries/${params.id}/viewings/recover`
                                  : action === 'contacts' || action === 'contact-record'
                                    ? `${base}/enquiries/${params.id}/contacts`
                                    : action === 'contact-recover'
                                      ? `${base}/enquiries/${params.id}/contacts/recover`
                                      : action === 'activity'
                                        ? `${base}/enquiries/${params.id}/activity`
                                        : action === 'detail'
                                          ? `${base}/enquiries/${params.id}`
                                          : action === 'command'
                                            ? `${base}/enquiries/${params.id}/operations`
                                            : `${base}/enquiries/${params.id}/operations/${params.operationId}`;
  if (
    url.pathname !== path ||
    (['list', 'queue', 'assignees', 'viewing-properties'].includes(action)
      ? params.id !== undefined || params.operationId !== undefined
      : !params.id) ||
    (action === 'operation' ? !params.operationId : params.operationId !== undefined)
  )
    throw new BoundaryError(400, 'INVALID_INPUT');
  if (
    [
      'reminder-admit',
      'reminder-admit-recover',
      'viewing-complete',
      'viewing-complete-recover',
      'viewing-no-show',
      'viewing-no-show-recover',
      'viewing-history',
      'viewing-detail',
      'viewing-propose',
      'viewing-confirm',
      'viewing-confirm-recover',
      'viewing-reschedule',
      'viewing-reschedule-recover',
      'viewing-cancel',
      'viewing-cancel-recover',
      'viewing-decline',
      'viewing-decline-recover',
    ].includes(action)
      ? !params.viewingId
      : params.viewingId !== undefined
  )
    throw new BoundaryError(400, 'INVALID_INPUT');
  if (params.actor === 'agent' && action === 'assignees') throw new BoundaryError(403, 'FORBIDDEN');
  let limit: number | undefined;
  if (action === 'queue') {
    try {
      if (!url.search && request.url.includes('?')) throw new Error();
      parseEnquiryQueueSearch(url.searchParams);
    } catch {
      throw new BoundaryError(400, 'INVALID_INPUT');
    }
  } else if (
    action === 'list' ||
    action === 'assignees' ||
    action === 'activity' ||
    action === 'contacts' ||
    action === 'viewing-list' ||
    action === 'viewing-properties' ||
    action === 'viewing-history'
  ) {
    if (request.url.includes('?') && !/^\?limit=[1-9]\d{0,2}$/.test(url.search))
      throw new BoundaryError(400, 'INVALID_INPUT');
    limit = url.search
      ? Number(url.search.slice(7))
      : ['contacts', 'viewing-list', 'viewing-properties', 'viewing-history'].includes(action)
        ? 25
        : action === 'assignees'
          ? 100
          : 50;
    if (
      limit < 1 ||
      limit >
        (['contacts', 'viewing-list', 'viewing-properties', 'viewing-history'].includes(action)
          ? 25
          : 100)
    )
      throw new BoundaryError(400, 'INVALID_INPUT');
  } else if (url.search || request.url.includes('?')) throw new BoundaryError(400, 'INVALID_INPUT');
  let forbidden = false;
  request.headers.forEach((_, name) => {
    if (
      [
        'cookie',
        'content-encoding',
        'expect',
        'range',
        'transfer-encoding',
        'x-actor-id',
        'x-tenant-id',
        'x-role',
        'x-actor',
        'x-tenant',
        'x-revision-version',
      ].includes(name) ||
      name.startsWith('if-')
    )
      forbidden = true;
    if (!bodyAction && ['content-length', 'content-type'].includes(name)) forbidden = true;
  });
  if (forbidden || (!bodyAction && request.body !== null))
    throw new BoundaryError(400, 'INVALID_INPUT');
  if (bodyAction) {
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      )
    )
      throw new BoundaryError(400, 'INVALID_INPUT');
    const length = request.headers.get('content-length');
    if (
      length !== null &&
      (!/^[1-9]\d{0,4}$/.test(length) ||
        Number(length) > (contact || viewingBody ? 16384 : MAX_BYTES))
    )
      throw new BoundaryError(400, 'INVALID_INPUT');
  }
  return limit;
}

async function commandBody(request: Request): Promise<EnquiryOperationInputV2>;
async function commandBody(request: Request, contact: true): Promise<ContactCommand>;
async function commandBody(request: Request, contact: 'viewing'): Promise<unknown>;
async function commandBody(
  request: Request,
  contact: boolean | 'viewing' = false,
): Promise<unknown> {
  if (request.signal.aborted) throw new BoundaryError(499, 'CANCELLED');
  const reader = request.body?.getReader();
  if (!reader) throw new BoundaryError(400, 'INVALID_INPUT');
  const maximum = contact ? 16384 : MAX_BYTES,
    bytes = new Uint8Array(maximum),
    started = performance.now();
  let size = 0,
    stop: BoundaryError | undefined;
  let rejectStop: (error: BoundaryError) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  void stopped.catch(() => undefined);
  const cancel = () => {
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* Do not wait for transport cleanup. */
    }
  };
  const interrupt = (status: number, code: string) => {
    if (stop) return;
    stop = new BoundaryError(status, code);
    cancel();
    rejectStop(stop);
  };
  const aborted = () => interrupt(499, 'CANCELLED'),
    timer = setTimeout(() => interrupt(504, 'PREVIEW_UNAVAILABLE'), BODY_TIMEOUT_MS);
  request.signal.addEventListener('abort', aborted, { once: true });
  try {
    for (;;) {
      if (request.signal.aborted) aborted();
      if (performance.now() - started >= BODY_TIMEOUT_MS) interrupt(504, 'PREVIEW_UNAVAILABLE');
      if (stop) throw stop;
      const item = await Promise.race([reader.read(), stopped]);
      if (stop) throw stop;
      if (item.done) break;
      if (
        !(item.value instanceof Uint8Array) ||
        item.value.byteLength === 0 ||
        item.value.byteLength > maximum - size
      )
        throw new BoundaryError(400, 'INVALID_INPUT');
      bytes.set(item.value, size);
      size += item.value.byteLength;
    }
    const declared = request.headers.get('content-length');
    if (size === 0 || (declared !== null && size !== Number(declared)))
      throw new BoundaryError(400, 'INVALID_INPUT');
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
      value: unknown = JSON.parse(source);
    // Consume whole strings and decode object keys, so escaped duplicates and
    // fractional/exponent versions cannot be rounded into a different command.
    const tokens =
        source.match(
          /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
        ) ?? [],
      containers: (Set<string> | null)[] = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (token === '{') containers.push(new Set());
      else if (token === '[') containers.push(null);
      else if (token === '}' || token === ']') containers.pop();
      else if (token.startsWith('"') && tokens[index + 1] === ':') {
        const keys = containers.at(-1),
          key = JSON.parse(token) as string;
        if (!keys || keys.has(key)) throw new BoundaryError(400, 'INVALID_INPUT');
        keys.add(key);
        if (
          ['expectedVersion', 'expectedEnquiryVersion'].includes(key) &&
          !/^[1-9]\d*$/.test(tokens[index + 2] ?? '')
        )
          throw new BoundaryError(400, 'INVALID_INPUT');
      }
    }
    if (contact === 'viewing') return value;
    const fields = contact
      ? ['operationId', 'expectedVersion', 'channel', 'outcome', 'occurredAt', 'notes']
      : [
          'operationId',
          'kind',
          'expectedVersion',
          'assignedAgentId',
          'status',
          'nextActionAt',
          'reason',
        ];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(value, field))
    )
      throw new BoundaryError(400, 'INVALID_INPUT');
    const record = value as Record<string, unknown>,
      version = record.expectedVersion;
    if (
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      version > Number.MAX_SAFE_INTEGER - (contact ? 0 : 1)
    )
      throw new BoundaryError(400, 'INVALID_INPUT');
    if (contact) return validateContactCommand({ ...record, expectedVersion: String(version) });
    return Object.freeze({
      ...record,
      expectedVersion: String(version),
    }) as unknown as EnquiryOperationInputV2;
  } catch (error) {
    if (error instanceof BoundaryError) throw error;
    throw new BoundaryError(400, 'INVALID_INPUT');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', aborted);
    cancel();
    try {
      reader.releaseLock();
    } catch {
      /* A pending cancelled read must not delay this result. */
    }
  }
}

async function viewingBody(
  request: Request,
  action: Action,
  viewingId?: string,
): Promise<ViewingOriginal> {
  const raw = await commandBody(request, 'viewing');
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
    const value = raw as Record<string, unknown>;
    const recovering = action === 'viewing-recover',
      kind = recovering ? value.kind : action === 'viewing-request' ? 'request' : 'propose';
    if (kind !== 'request' && kind !== 'propose') throw new Error();
    const command = (recovering ? value.command : value) as Record<string, unknown>;
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error();
    const key = kind === 'request' ? 'expectedEnquiryVersion' : 'expectedVersion',
      expected = command[key];
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1)
      throw new Error();
    const normalized = { ...command, [key]: String(expected) };
    return validateViewingOriginal(
      recovering
        ? { ...value, command: normalized }
        : kind === 'request'
          ? { kind, command: normalized }
          : { kind, viewingId, command: normalized },
    );
  } catch {
    throw new BoundaryError(400, 'INVALID_INPUT');
  }
}

async function confirmationBody(request: Request): Promise<ViewingConfirmationCommand> {
  const value = await commandBody(request, 'viewing');
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const raw = value as Record<string, unknown>,
      expected = raw.expectedVersion;
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1)
      throw new Error();
    return validateViewingConfirmationCommand({ ...raw, expectedVersion: String(expected) });
  } catch {
    throw new BoundaryError(400, 'INVALID_INPUT');
  }
}

async function rescheduleBody(request: Request): Promise<ViewingRescheduleCommand> {
  const value = await commandBody(request, 'viewing');
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const raw = value as Record<string, unknown>,
      expected = raw.expectedVersion;
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1)
      throw new Error();
    return validateViewingRescheduleCommand({ ...raw, expectedVersion: String(expected) });
  } catch {
    throw new BoundaryError(400, 'INVALID_INPUT');
  }
}

async function terminationBody(request: Request): Promise<ViewingTerminationCommand> {
  const value = await commandBody(request, 'viewing');
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const raw = value as Record<string, unknown>,
      expected = raw.expectedVersion;
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1)
      throw new Error();
    return validateViewingTerminationCommand({ ...raw, expectedVersion: String(expected) });
  } catch {
    throw new BoundaryError(400, 'INVALID_INPUT');
  }
}

async function outcomeBody(request: Request): Promise<ViewingOutcomeCommand> {
  const value = await commandBody(request, 'viewing');
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const raw = value as Record<string, unknown>,
      expected = raw.expectedVersion;
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1)
      throw new Error();
    return validateViewingOutcomeCommand({ ...raw, expectedVersion: String(expected) });
  } catch {
    throw new BoundaryError(400, 'INVALID_INPUT');
  }
}

async function reminderBody(
  request: Request,
  admission: boolean,
): Promise<ViewingReminderAdmissionCommand | ViewingReminderCaptureCommand> {
  const value = await commandBody(request, 'viewing');
  try {
    if (!admission) return validateViewingReminderCaptureCommand(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const raw = value as Record<string, unknown>,
      expected = raw.expectedVersion;
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1)
      throw new Error();
    return validateViewingReminderAdmissionCommand({ ...raw, expectedVersion: String(expected) });
  } catch {
    throw new BoundaryError(400, 'INVALID_INPUT');
  }
}

/** Trusted fixed-role development BFF. It never forwards a browser credential or retries a command. */
export async function enquiryPreviewRequest(
  request: Request,
  params: Params,
  action: Action,
): Promise<Response> {
  let config: ReturnType<typeof configuration>;
  try {
    config = configuration(params.actor, process.env);
    assertPreviewRequest(request, config.instanceId);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== `http://${request.headers.get('host')}`) throw new Error();
  } catch {
    return reply(403, 'PREVIEW_UNAVAILABLE');
  }
  if (
    request.method !==
    ([
      'reminder-admit',
      'reminder-admit-recover',
      'reminder-capture',
      'reminder-capture-recover',
      'viewing-complete',
      'viewing-complete-recover',
      'viewing-no-show',
      'viewing-no-show-recover',
      'command',
      'contact-record',
      'contact-recover',
      'viewing-request',
      'viewing-propose',
      'viewing-recover',
      'viewing-confirm',
      'viewing-confirm-recover',
      'viewing-reschedule',
      'viewing-reschedule-recover',
      'viewing-cancel',
      'viewing-cancel-recover',
      'viewing-decline',
      'viewing-decline-recover',
    ].includes(action)
      ? 'POST'
      : 'GET')
  )
    return reply(405, 'METHOD_NOT_ALLOWED');
  let writeDispatched = false;
  try {
    if (
      action.startsWith('reminder-') &&
      process.env.STAFF_REMINDER_CAPTURE_MODE !== 'capture-only-v1'
    )
      throw new BoundaryError(403, 'PREVIEW_UNAVAILABLE');
    const limit = requestShape(request, params, action);
    if (request.signal.aborted) throw new BoundaryError(499, 'CANCELLED');
    const reminder = action.startsWith('reminder-')
      ? await reminderBody(request, action.includes('admit'))
      : undefined;
    const command = action === 'command' ? await commandBody(request) : undefined;
    const contact = ['contact-record', 'contact-recover'].includes(action)
      ? await commandBody(request, true)
      : undefined;
    const viewing = ['viewing-request', 'viewing-propose', 'viewing-recover'].includes(action)
      ? await viewingBody(request, action, params.viewingId)
      : undefined;
    const outcome = [
      'viewing-complete',
      'viewing-complete-recover',
      'viewing-no-show',
      'viewing-no-show-recover',
    ].includes(action)
      ? await outcomeBody(request)
      : undefined;
    const reschedule = ['viewing-reschedule', 'viewing-reschedule-recover'].includes(action)
      ? await rescheduleBody(request)
      : undefined;
    const confirmation = ['viewing-confirm', 'viewing-confirm-recover'].includes(action)
      ? await confirmationBody(request)
      : undefined;
    const terminal = [
      'viewing-cancel',
      'viewing-cancel-recover',
      'viewing-decline',
      'viewing-decline-recover',
    ].includes(action)
      ? await terminationBody(request)
      : undefined;
    const client = new RealtorApiClient({
        baseUrl: config.origin,
        privacyNoticeVersion: 'synthetic-preview-v1',
        allowLoopbackHttp: true,
      }),
      options = { bearerToken: config.bearerToken, signal: request.signal, timeoutMs: 30000 };
    let result: unknown;
    if (reminder && action.includes('admit')) {
      if (action.endsWith('-recover'))
        result = await client.getViewingReminderAdmissionReceiptV2(
          params.id!,
          params.viewingId!,
          reminder as ViewingReminderAdmissionCommand,
          options,
        );
      else {
        writeDispatched = true;
        result = await client.admitViewingReminderV2(
          params.id!,
          params.viewingId!,
          reminder as ViewingReminderAdmissionCommand,
          options,
        );
      }
    } else if (reminder) {
      const admission = await client.getViewingReminderAdmissionSnapshotV2(
        params.id!,
        params.admissionOperationId!,
        options,
      );
      if (admission.actorId !== config.actorId)
        throw new ApiClientError('INVALID_RESPONSE', 'Unexpected reminder requester.');
      if (admission.outcome !== 'admitted') throw new BoundaryError(422, 'INVALID_STATE');
      if (action.endsWith('-recover'))
        result = await client.getViewingReminderCaptureReceiptV2(
          admission,
          reminder as ViewingReminderCaptureCommand,
          options,
        );
      else {
        writeDispatched = true;
        result = await client.captureViewingReminderV2(
          admission,
          reminder as ViewingReminderCaptureCommand,
          options,
        );
      }
    } else if (outcome) {
      const kind = action.startsWith('viewing-complete') ? 'complete' : 'no_show';
      if (action.endsWith('-recover'))
        result = await client.getViewingOutcomeReceiptV2(
          params.id!,
          params.viewingId!,
          kind,
          outcome,
          options,
        );
      else {
        writeDispatched = true;
        result = await client.recordViewingOutcomeV2(
          params.id!,
          params.viewingId!,
          kind,
          outcome,
          options,
        );
      }
    } else if (reschedule) {
      if (action.endsWith('-recover'))
        result = await client.getViewingRescheduleReceiptV2(
          params.id!,
          params.viewingId!,
          reschedule,
          options,
        );
      else {
        writeDispatched = true;
        result = await client.rescheduleViewingV2(
          params.id!,
          params.viewingId!,
          reschedule,
          options,
        );
      }
    } else if (terminal) {
      const kind = action.startsWith('viewing-cancel') ? 'cancel' : 'decline';
      if (action.endsWith('-recover'))
        result = await client.getViewingTerminationReceiptV2(
          params.id!,
          params.viewingId!,
          kind,
          terminal,
          options,
        );
      else {
        writeDispatched = true;
        result = await client.terminateViewingV2(
          params.id!,
          params.viewingId!,
          kind,
          terminal,
          options,
        );
      }
    } else if (action === 'viewing-confirm') {
      writeDispatched = true;
      result = await client.confirmViewingV2(params.id!, params.viewingId!, confirmation!, options);
    } else if (action === 'viewing-confirm-recover')
      result = await client.getViewingConfirmationReceiptV2(
        params.id!,
        params.viewingId!,
        confirmation!,
        options,
      );
    else if (action === 'viewing-properties') {
      const page = await client.listPropertiesV2({
        limit,
        signal: request.signal,
        timeoutMs: 30000,
      });
      result = validateViewingProperties(
        {
          items: page.items.map(({ id, title, locality, purpose }) => ({
            id,
            title,
            locality,
            purpose,
          })),
          limit: page.limit,
          mayBeTruncated: page.items.length === page.limit,
        },
        page.limit,
      );
    } else if (action === 'viewing-history')
      result = await client.getViewingHistoryV2(params.id!, params.viewingId!, {
        ...options,
        limit,
      });
    else if (action === 'viewing-list')
      result = await client.listViewingsV2(params.id!, { ...options, limit });
    else if (action === 'viewing-detail')
      result = await client.getViewingV2(params.id!, params.viewingId!, options);
    else if (action === 'viewing-recover')
      result = await client.getViewingReceiptV2(params.id!, viewing!, options);
    else if (action === 'viewing-request' && viewing?.kind === 'request') {
      writeDispatched = true;
      result = await client.requestViewingV2(params.id!, viewing.command, options);
    } else if (action === 'viewing-propose' && viewing?.kind === 'propose') {
      writeDispatched = true;
      result = await client.proposeViewingV2(
        params.id!,
        viewing.viewingId,
        viewing.command,
        options,
      );
    } else if (action === 'queue')
      result = await client.listStaffEnquiriesV3(
        parseEnquiryQueueSearch(new URL(request.url).searchParams),
        options,
      );
    else if (action === 'list') result = await client.listStaffEnquiriesV2({ ...options, limit });
    else if (action === 'assignees')
      result = await client.listEnquiryAssigneesV2({ ...options, limit });
    else if (action === 'contacts')
      result = await client.listContactsV2(params.id!, { ...options, limit });
    else if (action === 'contact-recover')
      result = await client.getContactReceiptV2(params.id!, contact!, options);
    else if (action === 'contact-record') {
      writeDispatched = true;
      result = await client.recordContactV2(params.id!, contact!, options);
    } else if (action === 'activity')
      result = await client.listEnquiryActivityV2(params.id!, { ...options, limit });
    else if (action === 'detail') result = await client.getStaffEnquiryV2(params.id!, options);
    else if (action === 'operation')
      result = await client.getEnquiryOperationV2(params.id!, params.operationId!, options);
    else {
      writeDispatched = true;
      result = await client.applyEnquiryOperationV2(params.id!, command!, options);
    }
    if (
      (reminder || viewing || confirmation || terminal || reschedule || outcome) &&
      (result as ViewingReceipt).actorId !== config.actorId
    )
      throw new ApiClientError('INVALID_RESPONSE', 'Unexpected viewing receipt actor.', {
        submissionUncertain: writeDispatched,
      });
    return Response.json(result, { status: 200, headers: HEADERS });
  } catch (error) {
    return failure(error, writeDispatched);
  }
}

/** Fixed synthetic staff identity remains server-only; browser cannot choose upstream credentials. */
export async function staffCapturePreviewRequest(
  request: Request,
  actor: string,
): Promise<Response> {
  let scope: ReturnType<typeof configuration>;
  try {
    scope = configuration(actor, process.env);
  } catch {
    return reply(403, 'PREVIEW_UNAVAILABLE');
  }
  return handleSyntheticEnquiry(request, {
    apiOrigin: scope.origin,
    noticeVersion: 'synthetic-staff-notice-v1',
    staff: { actor: scope.role, bearerToken: scope.bearerToken },
    authorize: (incoming) => assertPreviewRequest(incoming, scope.instanceId),
  });
}
