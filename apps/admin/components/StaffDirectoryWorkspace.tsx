'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StaffBranchPage, StaffInvitationPage, StaffBranchCurrent } from '@realtor/domain';
import {
  createStaffDirectoryClient,
  type StaffDirectoryClient,
} from '../lib/staff-directory-client.ts';
import {
  createStaffWriteController,
  type StaffWriteController,
} from '../lib/staff-write-controller.ts';
import type { StaffWriteScope, StaffWriteAttempt } from '../lib/staff-write-attempt.ts';
export default function StaffDirectoryWorkspace({
  scope,
  branches: initialBranches,
  invitations: initialInvitations,
}: {
  scope: StaffWriteScope;
  branches: StaffBranchPage;
  invitations: StaffInvitationPage;
}) {
  const controller = useRef<StaffWriteController | null>(null),
    client = useRef<StaffDirectoryClient | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<StaffWriteController['snapshot']> | null>(
      null,
    ),
    [branches, setBranches] = useState(initialBranches),
    [invitations, setInvitations] = useState(initialInvitations),
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
  const sync = () => {
    if (controller.current) setSnapshot(controller.current.snapshot());
  };
  useEffect(() => {
    let live = true;
    const api = createStaffDirectoryClient({ instanceId: scope.instanceId }, async (...args) => {
      const response = await fetch(...args);
      if (live && (response.status === 401 || response.status === 403)) {
        setDenied(true);
        setBranches({ policy: 'staff-branch-page-v1', items: [], nextAfter: null });
        setInvitations({ policy: 'staff-invitation-page-v1', items: [], nextAfter: null });
      }
      return response;
    });
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
      if (controller.current && !controller.current.snapshot().canNavigate) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const links = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        target &&
        !target.hasAttribute('data-staff-reverify') &&
        !controller.current?.snapshot().canNavigate
      ) {
        event.preventDefault();
        setMessage('Recover the retained original before leaving this workspace.');
      }
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', links, true);
    return () => {
      live = false;
      controller.current?.close();
      controller.current = null;
      client.current = null;
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', links, true);
    };
  }, [scope.instanceId, scope.tenantId, scope.actorId]);
  const locked =
    !snapshot || snapshot.busy || snapshot.blocked || !!snapshot.attempt || denied || reading;
  async function refresh(kind: 'branches' | 'invitations', after: string | null = null) {
    if (!client.current || denied) return;
    setReading(true);
    try {
      if (kind === 'branches') setBranches(await client.current.listBranches({ limit: 10, after }));
      else setInvitations(await client.current.listInvitations({ limit: 10, after }));
      setMessage('Current page refreshed.');
    } catch {
      setMessage('Current authorized page could not be confirmed. Reload to verify access.');
    } finally {
      setReading(false);
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
          'Result not confirmed. Keep this request and recover its original; no automatic retry was made.',
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
    prepare('invitation', {
      policy: 'staff-invitation-intent-v1',
      operationId: crypto.randomUUID(),
      recipientEmail: email,
      requestedRole: role,
      branchId: role === 'admin' ? null : branchId || null,
      expiresAfterHours: hours,
    });
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
  const attempt = snapshot?.attempt;
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
                    disabled={snapshot.busy}
                    onClick={() => {
                      try {
                        controller.current?.clear();
                        setMessage('Retained operation cleared explicitly.');
                        sync();
                      } catch {
                        setMessage('Storage must be verified before clearing.');
                        sync();
                      }
                    }}
                  >
                    {attempt.phase === 'resolved'
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
                  <button>Prepare invitation request</button>
                </fieldset>
              </form>
            </section>
          </div>
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
                  <button
                    disabled={locked || !revokeReason}
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
