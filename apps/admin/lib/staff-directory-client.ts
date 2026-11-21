import { ApiClientError } from '@realtor/api-client';
import {
  parseStaffInvitationJson,
  validateStaffInvitationIssueCommand,
  validateStaffInvitationRecipientSession,
  validateStaffInvitationRedemptionCommand,
  validateStaffInvitationRedemptionRecord,
  validateStaffInvitationRawSecret,
  type StaffInvitationRedemptionCommand,
  validateStaffInvitationIssueRecord,
  validateStaffInvitationIssueResponse,
  validateStaffIssuedInvitationState,
  type StaffInvitationIssueCommand,
  validateStaffDirectoryQuery,
  validateStaffBranchPage,
  validateStaffInvitationPage,
  validateStaffBranchCommand,
  validateStaffBranchRecord,
  validateStaffBranchCurrent,
  validateStaffInvitationIntent,
  validateStaffInvitationRequestRecord,
  validateStaffInvitationState,
  validateStaffInvitationRevocationCommand,
  validateStaffInvitationRevocationRecord,
  validateStaffMembershipPage,
  validateStaffMembershipCommand,
  validateStaffMembershipRecord,
  validateStaffMembershipCurrent,
  type StaffDirectoryQuery,
  type StaffBranchCommand,
  type StaffInvitationIntent,
  type StaffInvitationRevocationCommand,
  type StaffMembershipCommand,
} from '@realtor/domain';
import { readReferenceJson } from './reference-draft-wire.ts';
const uuid = (v: unknown): string => {
  if (
    typeof v !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
  )
    throw new ApiClientError('VALIDATION', 'Invalid staff identifier.');
  return v;
};
export function createStaffDirectoryClient(
  input: Readonly<{ instanceId: string }>,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
  lifetime: Readonly<{ signal?: AbortSignal; onAccessDenied?: () => void }> = {},
) {
  if (
    !input ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 1 ||
    typeof transport !== 'function'
  )
    throw new ApiClientError('VALIDATION', 'Invalid staff preview scope.');
  const d = Object.getOwnPropertyDescriptor(input, 'instanceId');
  if (!d?.enumerable || !Object.hasOwn(d, 'value'))
    throw new ApiClientError('VALIDATION', 'Invalid staff preview scope.');
  const instance = uuid(d.value),
    root = '/api/staff-directory/';
  async function request<T>(
    path: string,
    body: unknown,
    envelope: string,
    validate: (data: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const deadline = new AbortController(),
      timer = setTimeout(() => deadline.abort(), 15000),
      combined = AbortSignal.any([
        deadline.signal,
        ...(signal ? [signal] : []),
        ...(lifetime.signal ? [lifetime.signal] : []),
      ]),
      writing = body !== undefined;
    let dispatched = false,
      abort = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(Error('Interrupted'));
      combined.addEventListener('abort', abort, { once: true });
    });
    try {
      if (combined.aborted) throw new ApiClientError('CANCELLED', 'Cancelled.');
      const text = writing ? JSON.stringify(body) : undefined;
      if (text !== undefined && new TextEncoder().encode(text).byteLength > 8192)
        throw new ApiClientError('VALIDATION', 'Staff command too large.');
      dispatched = true;
      const pending = Promise.resolve(
        transport(path, {
          method: writing ? 'POST' : 'GET',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: combined,
          headers: {
            Accept: 'application/json',
            'X-Preview-Instance': instance,
            ...(writing ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(text === undefined ? {} : { body: text }),
        }),
      );
      void pending.then(
        (response) => {
          if (combined.aborted) void response.body?.cancel().catch(() => {});
        },
        () => {},
      );
      const response = await Promise.race([pending, interrupted]);
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400) ||
        response.headers.has('content-range')
      ) {
        void response.body?.cancel().catch(() => {});
        throw Error('Invalid response.');
      }
      if (response.url) {
        const actual = new URL(response.url);
        if (
          actual.pathname + actual.search !== path ||
          actual.hash ||
          actual.username ||
          actual.password ||
          (typeof location !== 'undefined' && actual.origin !== location.origin)
        ) {
          void response.body?.cancel().catch(() => {});
          throw Error('Wrong response target.');
        }
      }
      if (
        (path.includes('/invitation-issues/') || path.startsWith('/api/invitation-acceptance/')) &&
        response.headers.get('cache-control') !== 'no-store'
      ) {
        void response.body?.cancel().catch(() => {});
        throw Error('Private response cannot be cached.');
      }
      if (response.status === 401 || response.status === 403) lifetime.onAccessDenied?.();
      const data = await readReferenceJson(
        response,
        envelope === 'page' ? 65536 : 8192,
        combined,
        parseStaffInvitationJson,
      );
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw Error('Invalid response.');
      const record = data as Record<string, unknown>,
        keys = Object.keys(record);
      if (!response.ok) {
        if (
          response.status < 400 ||
          response.status > 599 ||
          typeof record.error !== 'string' ||
          !/^[A-Z_]{1,80}$/.test(record.error) ||
          keys.some((k) => !['error', 'submissionUncertain'].includes(k)) ||
          (writing && typeof record.submissionUncertain !== 'boolean')
        )
          throw Error('Invalid failure.');
        throw new ApiClientError('HTTP', 'Staff request unavailable.', {
          status: response.status,
          submissionUncertain: writing && record.submissionUncertain === true,
        });
      }
      const expected = writing && path.includes('/invitations/operations/') ? 202 : 200;
      if (response.status !== expected || keys.length !== 1 || keys[0] !== envelope)
        throw Error('Invalid successful envelope.');
      if (combined.aborted) throw new ApiClientError('CANCELLED', 'Cancelled.');
      return validate(record[envelope]);
    } catch (error) {
      if (error instanceof ApiClientError && error.kind === 'HTTP') throw error;
      throw new ApiClientError(
        deadline.signal.aborted
          ? 'TIMEOUT'
          : signal?.aborted || lifetime.signal?.aborted
            ? 'CANCELLED'
            : error instanceof ApiClientError
              ? error.kind
              : 'INVALID_RESPONSE',
        'Staff result unconfirmed.',
        { submissionUncertain: writing && dispatched },
      );
    } finally {
      clearTimeout(timer);
      combined.removeEventListener('abort', abort);
    }
  }
  const queryPath = (kind: string, input: StaffDirectoryQuery) => {
    const q = validateStaffDirectoryQuery(input);
    return {
      q,
      path: root + kind + '?limit=' + q.limit + (q.after === null ? '' : '&after=' + q.after),
    };
  };
  return Object.freeze({
    getInvitationRecipientSession(signal?: AbortSignal) {
      return request(
        '/api/invitation-acceptance/session',
        undefined,
        'session',
        validateStaffInvitationRecipientSession,
        signal,
      );
    },
    acceptInvitation(
      input: StaffInvitationRedemptionCommand,
      rawSecret: string,
      signal?: AbortSignal,
    ) {
      const c = validateStaffInvitationRedemptionCommand(input),
        secret = validateStaffInvitationRawSecret(rawSecret);
      return request(
        '/api/invitation-acceptance/' + c.invitationId + '/operations/' + c.operationId,
        { command: c, secret },
        'receipt',
        (v) => validateStaffInvitationRedemptionRecord(v, c.operationId, c.invitationId),
        signal,
      );
    },
    getInvitationRedemption(input: StaffInvitationRedemptionCommand, signal?: AbortSignal) {
      const c = validateStaffInvitationRedemptionCommand(input);
      return request(
        '/api/invitation-acceptance/' + c.invitationId + '/operations/' + c.operationId,
        undefined,
        'receipt',
        (v) => validateStaffInvitationRedemptionRecord(v, c.operationId, c.invitationId),
        signal,
      );
    },
    issueInvitation(input: StaffInvitationIssueCommand, signal?: AbortSignal) {
      const c = validateStaffInvitationIssueCommand(input);
      return request(
        root + 'invitation-issues/' + c.invitationId + '/operations/' + c.operationId,
        c,
        'disclosure',
        (v) => validateStaffInvitationIssueResponse(v, c.operationId, c.invitationId),
        signal,
      );
    },
    getInvitationIssue(input: StaffInvitationIssueCommand, signal?: AbortSignal) {
      const c = validateStaffInvitationIssueCommand(input);
      return request(
        root + 'invitation-issues/' + c.invitationId + '/operations/' + c.operationId,
        undefined,
        'receipt',
        (v) => validateStaffInvitationIssueRecord(v, c.operationId, c.invitationId),
        signal,
      );
    },
    getIssuedInvitationState(input: StaffInvitationIssueCommand, signal?: AbortSignal) {
      const c = validateStaffInvitationIssueCommand(input);
      return request(
        root + 'invitation-issues/' + c.invitationId + '/operations/' + c.operationId + '/state',
        undefined,
        'state',
        (v) => validateStaffIssuedInvitationState(v, c.operationId, c.invitationId),
        signal,
      );
    },
    listMemberships(input: StaffDirectoryQuery, signal?: AbortSignal) {
      const { q, path } = queryPath('memberships', input);
      return request(path, undefined, 'page', (v) => validateStaffMembershipPage(v, q), signal);
    },
    saveMembership(input: StaffMembershipCommand, signal?: AbortSignal) {
      const c = validateStaffMembershipCommand(input);
      return request(
        root + 'memberships/operations/' + c.operationId,
        c,
        'receipt',
        (v) => validateStaffMembershipRecord(v, c),
        signal,
      );
    },
    getMembershipOperation(id: string, signal?: AbortSignal) {
      const op = uuid(id);
      return request(
        root + 'memberships/operations/' + op,
        undefined,
        'receipt',
        (v) => {
          const r = validateStaffMembershipRecord(v);
          if (r.operationId !== op) throw Error();
          return r;
        },
        signal,
      );
    },
    getMembership(id: string, signal?: AbortSignal) {
      const member = uuid(id);
      return request(
        root + 'memberships/' + member,
        undefined,
        'member',
        (v) => validateStaffMembershipCurrent(v, member),
        signal,
      );
    },
    listBranches(input: StaffDirectoryQuery, signal?: AbortSignal) {
      const { q, path } = queryPath('branches', input);
      return request(path, undefined, 'page', (v) => validateStaffBranchPage(v, q), signal);
    },
    listInvitations(input: StaffDirectoryQuery, signal?: AbortSignal) {
      const { q, path } = queryPath('invitations', input);
      return request(path, undefined, 'page', (v) => validateStaffInvitationPage(v, q), signal);
    },
    saveBranch(input: StaffBranchCommand, signal?: AbortSignal) {
      const c = validateStaffBranchCommand(input);
      return request(
        root + 'branches/operations/' + c.operationId,
        c,
        'receipt',
        (v) => validateStaffBranchRecord(v, c),
        signal,
      );
    },
    getBranchOperation(id: string, signal?: AbortSignal) {
      const op = uuid(id);
      return request(
        root + 'branches/operations/' + op,
        undefined,
        'receipt',
        (v) => {
          const r = validateStaffBranchRecord(v);
          if (r.operationId !== op) throw Error();
          return r;
        },
        signal,
      );
    },
    getBranch(id: string, signal?: AbortSignal) {
      const branch = uuid(id);
      return request(
        root + 'branches/' + branch,
        undefined,
        'branch',
        (v) => validateStaffBranchCurrent(v, branch),
        signal,
      );
    },
    captureInvitation(input: StaffInvitationIntent, signal?: AbortSignal) {
      const c = validateStaffInvitationIntent(input);
      return request(
        root + 'invitations/operations/' + c.operationId,
        c,
        'receipt',
        (v) => validateStaffInvitationRequestRecord(v, c),
        signal,
      );
    },
    getInvitationOperation(id: string, signal?: AbortSignal) {
      const op = uuid(id);
      return request(
        root + 'invitations/operations/' + op,
        undefined,
        'receipt',
        (v) => {
          const r = validateStaffInvitationRequestRecord(v);
          if (r.operationId !== op) throw Error();
          return r;
        },
        signal,
      );
    },
    getInvitation(id: string, signal?: AbortSignal) {
      const invitation = uuid(id);
      return request(
        root + 'invitations/' + invitation,
        undefined,
        'state',
        (v) => validateStaffInvitationState(v, invitation),
        signal,
      );
    },
    revokeInvitation(input: StaffInvitationRevocationCommand, signal?: AbortSignal) {
      const c = validateStaffInvitationRevocationCommand(input);
      return request(
        root + 'invitations/' + c.invitationId + '/revocations/' + c.operationId,
        c,
        'receipt',
        (v) => validateStaffInvitationRevocationRecord(v, c),
        signal,
      );
    },
    getInvitationRevocation(invitationId: string, operationId: string, signal?: AbortSignal) {
      const invitation = uuid(invitationId),
        op = uuid(operationId);
      return request(
        root + 'invitations/' + invitation + '/revocations/' + op,
        undefined,
        'receipt',
        (v) => {
          const r = validateStaffInvitationRevocationRecord(v);
          if (r.invitationId !== invitation || r.operationId !== op) throw Error();
          return r;
        },
        signal,
      );
    },
  });
}
export type StaffDirectoryClient = ReturnType<typeof createStaffDirectoryClient>;
