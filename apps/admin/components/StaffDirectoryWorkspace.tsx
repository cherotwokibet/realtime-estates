'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  StaffBranchPage,
  StaffInvitationPage,
  StaffBranchCurrent,
  StaffMembershipCurrent,
  StaffMembershipPage,
} from '@realtor/domain';
import {
  createStaffDirectoryClient,
  type StaffDirectoryClient,
} from '../lib/staff-directory-client.ts';
import {
  createStaffWriteController,
  type StaffWriteController,
} from '../lib/staff-write-controller.ts';
import type { StaffWriteScope, StaffWriteAttempt } from '../lib/staff-write-attempt.ts';
import PrivateWorkspaceBoundary, { usePrivateWorkspaceClear } from './PrivateWorkspaceBoundary.tsx';
import { staffInvitationIntentForPage } from '../lib/staff-invitation-selection.ts';
type StaffDirectoryProps = {
  scope: StaffWriteScope;
  branches: StaffBranchPage;
  invitations: StaffInvitationPage;
  memberships?: StaffMembershipPage | null;
  issuanceEnabled?: boolean;
};
export default function StaffDirectoryWorkspace(props: StaffDirectoryProps) {
  return (
    <PrivateWorkspaceBoundary
      key={[props.scope.instanceId, props.scope.tenantId, props.scope.actorId].join(':')}
      access={{ profile: 'staff', ...props.scope, role: 'admin' }}
    >
      <StaffDirectoryContent {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function StaffDirectoryContent({
  scope,
  branches: initialBranches,
  invitations: initialInvitations,
  memberships: initialMemberships = null,
  issuanceEnabled = false,
}: StaffDirectoryProps) {
  const clearPrivate = usePrivateWorkspaceClear();
  const visibleSecret = useRef<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const controller = useRef<StaffWriteController | null>(null),
    client = useRef<StaffDirectoryClient | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<StaffWriteController['snapshot']> | null>(
      null,
    ),
    [branches, setBranches] = useState(initialBranches),
    [invitations, setInvitations] = useState(initialInvitations),
    [memberships, setMemberships] = useState(initialMemberships),
    [message, setMessage] = useState(''),
    [denied, setDenied] = useState(false),
    [reading, setReading] = useState(false),
    [replay, setReplay] = useState(false);
  const [branch, setBranch] = useState<StaffBranchCurrent | null>(null),
    [name, setName] = useState(''),
    [active, setActive] = useState(true),
    [branchReason, setBranchReason] = useState('');
  const [email, setEmail] = useState(''),
    [role, setRole] = useState<'agent' | 'admin'>('agent'),
    [branchId, setBranchId] = useState(''),
    [hours, setHours] = useState<24 | 72 | 168>(24),
    [revokeReason, setRevokeReason] = useState('');
  const [member, setMember] = useState<StaffMembershipCurrent | null>(null),
    [memberRole, setMemberRole] = useState<'agent' | 'admin'>('agent'),
    [memberActive, setMemberActive] = useState(true),
    [memberReason, setMemberReason] = useState('');
  const sync = () => {
    if (controller.current) setSnapshot(controller.current.snapshot());
  };
  useEffect(() => {
    let live = true;
    const lifetime = new AbortController();
    const api = createStaffDirectoryClient(
      { instanceId: scope.instanceId },
      async (...args) => {
        const response = await fetch(...args);
        if (live && (response.status === 401 || response.status === 403)) {
          setDenied(true);
          visibleSecret.current = null;
          setSecret(null);
          controller.current?.close();
          setBranches({ policy: 'staff-branch-page-v1', items: [], nextAfter: null });
          setInvitations({ policy: 'staff-invitation-page-v1', items: [], nextAfter: null });
          setMemberships(null);
          setMember(null);
        }
        return response;
      },
      { signal: lifetime.signal, onAccessDenied: clearPrivate },
    );
    client.current = api;
    try {
      controller.current = createStaffWriteController({
        scope,
        store: window.sessionStorage,
        client: api,
      });
      sync();
    } catch {
      setMessage('Retained operation storage is unavailable. No write can start.');
    }
    const before = (event: BeforeUnloadEvent) => {
      if (
        visibleSecret.current !== null ||
        (controller.current && !controller.current.snapshot().canNavigate)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const links = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        target &&
        !target.hasAttribute('data-staff-reverify') &&
        (!controller.current?.snapshot().canNavigate || visibleSecret.current !== null)
      ) {
        event.preventDefault();
        setMessage('Recover the retained original before leaving this workspace.');
      }
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', links, true);
    return () => {
      live = false;
      lifetime.abort();
      visibleSecret.current = null;
      controller.current?.close();
      controller.current = null;
      client.current = null;
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', links, true);
    };
  }, [scope.instanceId, scope.tenantId, scope.actorId]);
  const locked =
    !snapshot || snapshot.busy || snapshot.blocked || !!snapshot.attempt || denied || reading;
  async function refresh(
    kind: 'branches' | 'invitations' | 'memberships',
    after: string | null = null,
  ) {
    if (!client.current || denied) return;
    const api = client.current;
    setReading(true);
    try {
      if (kind === 'branches') {
        const value = await api.listBranches({ limit: 10, after });
        if (client.current !== api) return;
        setBranches(value);
      } else if (kind === 'invitations') {
        const value = await api.listInvitations({ limit: 10, after });
        if (client.current !== api) return;
        setInvitations(value);
      } else if (memberships !== null) {
        const value = await api.listMemberships({ limit: 10, after });
        if (client.current !== api) return;
        setMemberships(value);
      }
      if (client.current === api) setMessage('Current page refreshed.');
    } catch {
      if (client.current === api)
        setMessage('Current authorized page could not be confirmed. Reload to verify access.');
    } finally {
      if (client.current === api) setReading(false);
    }
  }

  function prepare(kind: StaffWriteAttempt['kind'], command: unknown) {
    try {
      controller.current?.prepare(kind, command);
      setReplay(false);
      setMessage('Review the retained original, then submit explicitly.');
      sync();
    } catch {
      setMessage('Review the exact fields. An unresolved operation cannot be replaced.');
      sync();
    }
  }
  async function run(kind: 'submit' | 'recover' | 'replay') {
    const c = controller.current;
    if (!c || denied) return;
    try {
      const pending =
        kind === 'replay' ? c.replay(replay) : kind === 'recover' ? c.recover() : c.submit();
      sync();
      await pending;
      if (controller.current !== c) return;
      setMessage('Original result verified. Acknowledge it before preparing another operation.');
    } catch {
      if (controller.current === c)
        setMessage(
          c.snapshot().attempt?.phase === 'refused'
            ? 'Issuance was refused without a write. Acknowledge the refusal, then refresh invitations.'
            : 'Result not confirmed. Keep this request and recover its original; no automatic retry was made.',
        );
    } finally {
      if (controller.current === c) sync();
    }
  }
  function branchForm(event: FormEvent) {
    event.preventDefault();
    prepare('branch', {
      policy: 'staff-branch-command-v1',
      operationId: crypto.randomUUID(),
      branchId: branch?.branchId ?? crypto.randomUUID(),
      expectedVersion: branch?.version ?? '0',
      name,
      active,
      reason: branchReason,
    });
  }
  function invitationForm(event: FormEvent) {
    event.preventDefault();
    try {
      const command = staffInvitationIntentForPage(branches, {
        policy: 'staff-invitation-intent-v1',
        operationId: crypto.randomUUID(),
        recipientEmail: email,
        requestedRole: role,
        branchId: role === 'admin' ? null : branchId || null,
        expiresAfterHours: hours,
      });
      prepare('invitation', command);
    } catch {
      setMessage(
        'Choose an active branch on this page or explicitly choose company-wide, then review the invitation fields.',
      );
    }
  }
  async function prepareIssue(id: string) {
    if (locked || !issuanceEnabled || !client.current) return;
    const api = client.current;
    setReading(true);
    try {
      const state = await api.getInvitation(id);
      if (api !== client.current || controller.current?.snapshot().closed) return;
      if (state.state !== 'pending') throw Error();
      prepare('issuance', {
        policy: 'staff-invitation-issue-command-v1',
        operationId: crypto.randomUUID(),
        invitationId: id,
      });
    } catch {
      setMessage('A current pending invitation is required. Refresh the invitation page.');
    } finally {
      setReading(false);
    }
  }
  async function adopt(id: string) {
    if (locked || !client.current) return;
    setReading(true);
    try {
      const value = await client.current.getBranch(id);
      setBranch(value);
      setName(value.name);
      setActive(value.active);
      setBranchReason('');
      setMessage('Current branch adopted. Review the change and reason.');
    } catch {
      setMessage('Current branch unavailable.');
    } finally {
      setReading(false);
    }
  }
  async function revoke(id: string) {
    if (locked || !client.current) return;
    setReading(true);
    try {
      const value = await client.current.getInvitation(id);
      prepare('revocation', {
        policy: 'staff-invitation-revocation-command-v1',
        operationId: crypto.randomUUID(),
        invitationId: id,
        expectedVersion: value.version,
        reason: revokeReason,
      });
    } catch {
      setMessage('Review the revocation reason and current invitation state.');
    } finally {
      setReading(false);
    }
  }
  async function adoptMember(id: string) {
    if (locked || !client.current || memberships === null || id === scope.actorId) return;
    setReading(true);
    try {
      const current = await client.current.getMembership(id);
      setMember(current);
      setMemberRole(current.role);
      setMemberActive(current.active);
      setMemberReason('');
      setMessage('Current staff access adopted. Review role, active access and reason.');
    } catch {
      setMessage('Current staff access could not be verified.');
    } finally {
      setReading(false);
    }
  }
  function membershipForm(event: FormEvent) {
    event.preventDefault();
    if (locked || !member || memberships === null || member.memberId === scope.actorId) return;
    prepare('membership', {
      policy: 'staff-membership-command-v1',
      operationId: crypto.randomUUID(),
      memberId: member.memberId,
      expectedVersion: member.version,
      requestedRole: memberRole,
      active: memberActive,
      reason: memberReason,
    });
  }
  const attempt = snapshot?.attempt;
  const branchSelectionUnavailable =
    role === 'agent' &&
    branchId !== '' &&
    !branches.items.some((b) => b.branchId === branchId && b.active);
  return (
    <div className="staff-workspace">
      <p role="status" aria-live="polite">
        {message ||
          'Prepare one exact request at a time. Original recovery never submits another write.'}
      </p>
      {denied ? (
        <section role="alert">
          <h2>Current access unavailable</h2>
          <p>
            Private pages are hidden. Any unresolved request is retained for recovery after access
            is verified.
          </p>
          <a href="/staff" data-staff-reverify>
            Reload and verify access
          </a>
        </section>
      ) : (
        <>
          <section className="staff-recovery">
            <h2>Retained operation</h2>
            {!snapshot ? (
              <p>Opening retained operation storage…</p>
            ) : snapshot.blocked ? (
              <p role="alert">
                Storage cannot be verified. No write can start; preserve this browser session.
              </p>
            ) : attempt ? (
              <>
                <p>
                  <strong>
                    {attempt.kind} · {attempt.phase}
                  </strong>
                </p>
                <p>Operation {attempt.command.operationId}</p>
                <p>
                  {attempt.kind === 'branch'
                    ? attempt.command.name
                    : attempt.kind === 'invitation'
                      ? attempt.command.recipientEmail
                      : attempt.kind === 'membership'
                        ? 'Staff member ' + attempt.command.memberId
                        : 'Invitation ' + attempt.command.invitationId}
                </p>
                <details>
                  <summary>Review exact original request</summary>
                  <pre>{JSON.stringify(attempt.command, null, 2)}</pre>
                </details>
                {attempt.receipt && (
                  <p>
                    Verified original:{' '}
                    {'outcome' in attempt.receipt
                      ? attempt.receipt.outcome
                      : 'recorded; delivery not attempted; no membership granted'}
                    .
                  </p>
                )}
                {attempt.kind === 'issuance' && attempt.phase === 'resolved' && (
                  <section aria-label="One-time invitation code">
                    <h3>Invitation issuance confirmed</h3>
                    <p>
                      No email was sent. The code grants access only to the verified matching
                      recipient before expiry. Issuance itself does not grant membership.
                    </p>
                    {snapshot.secretAvailable ? (
                      <>
                        <p>The code can be revealed once. It is not stored with this operation.</p>
                        <button
                          onClick={() => {
                            try {
                              const value = controller.current!.takeSecretOnce();
                              visibleSecret.current = value;
                              setSecret(value);
                              sync();
                            } catch {
                              setMessage(
                                'Code unavailable. Recover metadata or revoke and create a new request.',
                              );
                            }
                          }}
                        >
                          Reveal invitation code once
                        </button>
                        <button
                          onClick={() => {
                            controller.current?.discardSecret();
                            sync();
                            setMessage(
                              'Code discarded. Revoke this invitation and create a new request if another code is needed.',
                            );
                          }}
                        >
                          Discard unrevealed code
                        </button>
                      </>
                    ) : secret ? (
                      <>
                        <label>
                          Invitation code
                          <input readOnly value={secret} autoComplete="off" spellCheck={false} />
                        </label>
                        <p>Keep this code private. Closing or reloading loses this view.</p>
                        <button
                          onClick={() => {
                            visibleSecret.current = null;
                            setSecret(null);
                            sync();
                            setMessage('Code view discarded. It cannot be revealed again.');
                          }}
                        >
                          Discard code view
                        </button>
                      </>
                    ) : (
                      <p>
                        The code is unavailable. Original recovery returns metadata only. If it was
                        lost, explicitly revoke this invitation, then capture and issue a new one.
                      </p>
                    )}
                  </section>
                )}
                {attempt.phase === 'prepared' && (
                  <button disabled={snapshot.busy} onClick={() => void run('submit')}>
                    Submit reviewed original
                  </button>
                )}
                {attempt.phase === 'uncertain' && (
                  <>
                    <button disabled={snapshot.busy} onClick={() => void run('recover')}>
                      Recover original by GET
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={replay}
                        onChange={(e) => setReplay(e.target.checked)}
                      />
                      I explicitly want to replay this exact original request
                    </label>
                    <button disabled={snapshot.busy || !replay} onClick={() => void run('replay')}>
                      Replay exact original
                    </button>
                    <p>Do not create a replacement or discard an uncertain operation.</p>
                  </>
                )}
                {attempt.phase !== 'uncertain' && (
                  <button
                    disabled={snapshot.busy || snapshot.secretAvailable || secret !== null}
                    onClick={() => {
                      try {
                        controller.current?.clear();
                        if (attempt.kind === 'issuance') void refresh('invitations');
                        if (attempt.phase === 'resolved' && attempt.kind === 'branch') {
                          setBranch(null);
                          setName('');
                          setActive(true);
                          setBranchReason('');
                        }
                        if (attempt.phase === 'resolved' && attempt.kind === 'invitation') {
                          setEmail('');
                          setRole('agent');
                          setBranchId('');
                          setHours(24);
                        }
                        if (attempt.phase === 'resolved' && attempt.kind === 'revocation')
                          setRevokeReason('');
                        if (attempt.phase === 'resolved' && attempt.kind === 'membership') {
                          setMember(null);
                          setMemberReason('');
                        }
                        setMessage(
                          'Retained operation cleared explicitly. Adopt the current version before further branch or staff changes.',
                        );
                        sync();
                      } catch {
                        setMessage('Storage must be verified before clearing.');
                        sync();
                      }
                    }}
                  >
                    {attempt.phase === 'refused'
                      ? 'Acknowledge refusal and clear request'
                      : attempt.phase === 'resolved'
                        ? 'Acknowledge and clear original'
                        : 'Discard undispatched request'}
                  </button>
                )}
              </>
            ) : (
              <p>No retained operation.</p>
            )}
          </section>
          <div className="staff-forms">
            <section>
              <h2>{branch ? 'Edit branch metadata' : 'Create branch metadata'}</h2>
              <p>Branch metadata does not assign staff or change membership.</p>
              <form onSubmit={branchForm}>
                <fieldset disabled={locked}>
                  <label>
                    Branch name
                    <input
                      value={name}
                      maxLength={320}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    Branch active
                  </label>
                  <label>
                    Reason
                    <textarea
                      value={branchReason}
                      onChange={(e) => setBranchReason(e.target.value)}
                      required
                    />
                  </label>
                  <button>Prepare branch request</button>
                  {branch && (
                    <button
                      type="button"
                      onClick={() => {
                        setBranch(null);
                        setName('');
                        setActive(true);
                        setBranchReason('');
                      }}
                    >
                      Start a new branch draft
                    </button>
                  )}
                </fieldset>
              </form>
            </section>
            <section>
              <h2>Record an invitation request</h2>
              <p>No email, secret, acceptance or access grant is created.</p>
              <form onSubmit={invitationForm}>
                <fieldset disabled={locked}>
                  <label>
                    Recipient email (lowercase)
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Requested role
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'agent' | 'admin')}
                    >
                      <option value="agent">Agent</option>
                      <option value="admin">Company admin</option>
                    </select>
                  </label>
                  <label>
                    Branch
                    <select
                      value={role === 'admin' ? '' : branchId}
                      disabled={role === 'admin'}
                      onChange={(e) => setBranchId(e.target.value)}
                    >
                      <option value="">Company-wide</option>
                      {branchSelectionUnavailable && (
                        <option value={branchId} disabled>
                          Previous branch unavailable on this page — choose a branch
                        </option>
                      )}
                      {branches.items
                        .filter((b) => b.active)
                        .map((b) => (
                          <option key={b.branchId} value={b.branchId}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Request lifetime
                    <select
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value) as 24 | 72 | 168)}
                    >
                      <option value={24}>24 hours</option>
                      <option value={72}>72 hours</option>
                      <option value={168}>7 days</option>
                    </select>
                  </label>
                  {branchSelectionUnavailable && (
                    <p role="alert">
                      Choose an active branch from this page or explicitly choose company-wide.
                    </p>
                  )}
                  <button disabled={branchSelectionUnavailable}>Prepare invitation request</button>
                </fieldset>
              </form>
            </section>
          </div>
          {memberships !== null && (
            <section>
              <h2>Existing staff access</h2>
              <p>
                Choose existing staff to review their current access. Your own access cannot be
                changed here. No new membership is created.
              </p>
              <button
                disabled={reading || !!snapshot?.busy}
                onClick={() => void refresh('memberships')}
              >
                Refresh first staff page
              </button>
              <ul>
                {memberships.items.map((entry) => (
                  <li key={entry.memberId}>
                    <strong>Staff member {entry.memberId}</strong> · {entry.role} ·{' '}
                    {entry.active ? 'Active' : 'Inactive'} · version {entry.version}
                    {entry.memberId === scope.actorId ? (
                      <span> · You; own access changes unavailable.</span>
                    ) : (
                      <button disabled={locked} onClick={() => void adoptMember(entry.memberId)}>
                        Review current access for {entry.memberId}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {memberships.nextAfter && (
                <button
                  disabled={reading || !!snapshot?.busy}
                  onClick={() => void refresh('memberships', memberships.nextAfter)}
                >
                  Next staff page
                </button>
              )}
              {member && (
                <form onSubmit={membershipForm}>
                  <h3>Change existing staff access</h3>
                  <p>
                    Member {member.memberId} · adopted version {member.version}
                  </p>
                  <fieldset disabled={locked}>
                    <label>
                      Staff role
                      <select
                        value={memberRole}
                        onChange={(e) => setMemberRole(e.target.value as 'agent' | 'admin')}
                      >
                        <option value="agent">Agent</option>
                        <option value="admin">Company admin</option>
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={memberActive}
                        onChange={(e) => setMemberActive(e.target.checked)}
                      />
                      Staff access active
                    </label>
                    <label>
                      Staff access reason
                      <textarea
                        value={memberReason}
                        onChange={(e) => setMemberReason(e.target.value)}
                        required
                      />
                    </label>
                    <button>Prepare staff access change</button>
                    <button
                      type="button"
                      onClick={() => {
                        setMember(null);
                        setMemberReason('');
                      }}
                    >
                      Discard staff access draft
                    </button>
                  </fieldset>
                </form>
              )}
              <p>
                Rows use member IDs in this synthetic preview. Identity display names require the
                verified account integration.
              </p>
            </section>
          )}
          <section>
            <h2>Branches · current page</h2>
            <button disabled={reading || !!snapshot?.busy} onClick={() => void refresh('branches')}>
              Refresh first branch page
            </button>
            <ul>
              {branches.items.map((b) => (
                <li key={b.branchId}>
                  <strong>{b.name}</strong> · {b.active ? 'Active' : 'Inactive'} · version{' '}
                  {b.version}{' '}
                  <button disabled={locked} onClick={() => void adopt(b.branchId)}>
                    Adopt current branch for editing
                  </button>
                </li>
              ))}
            </ul>
            {branches.nextAfter && (
              <button
                disabled={reading || !!snapshot?.busy}
                onClick={() => void refresh('branches', branches.nextAfter)}
              >
                Next branch page
              </button>
            )}
          </section>
          <section>
            <h2>Invitation requests · current page</h2>
            {issuanceEnabled && (
              <p>
                One-time codes are enabled for synthetic requests. Issued and used states are
                current; the original capture remains historical. Recipients accept using a
                separately verified identity and the private code.
              </p>
            )}
            <button
              disabled={reading || !!snapshot?.busy}
              onClick={() => void refresh('invitations')}
            >
              Refresh first invitation page
            </button>
            <label>
              Revocation reason
              <textarea
                disabled={locked}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
              />
            </label>
            <ul>
              {invitations.items.map((i) => (
                <li key={i.operationId}>
                  <strong>{i.recipientEmail}</strong> · {i.requestedRole} · {i.state} ·{' '}
                  {i.branch?.name ?? 'Company-wide'}{' '}
                  {issuanceEnabled && i.state === 'pending' && (
                    <button disabled={locked} onClick={() => void prepareIssue(i.operationId)}>
                      Prepare one-time invitation code
                    </button>
                  )}
                  <button
                    disabled={locked || !revokeReason || i.state === 'used'}
                    onClick={() => void revoke(i.operationId)}
                  >
                    Prepare revocation
                  </button>
                </li>
              ))}
            </ul>
            {invitations.nextAfter && (
              <button
                disabled={reading || !!snapshot?.busy}
                onClick={() => void refresh('invitations', invitations.nextAfter)}
              >
                Next invitation page
              </button>
            )}
            <p>
              Pages use stable IDs, not chronological order. Refresh from the first page to include
              newly inserted records.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
