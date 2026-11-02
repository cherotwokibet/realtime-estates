'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StaffInvitationRecipientSession } from '@realtor/domain';
import {
  createStaffDirectoryClient,
  type StaffDirectoryClient,
} from '../lib/staff-directory-client.ts';
import {
  createStaffWriteController,
  type StaffWriteController,
} from '../lib/staff-write-controller.ts';

export default function InvitationAcceptanceWorkspace({
  instanceId,
  session,
}: {
  instanceId: string;
  session: StaffInvitationRecipientSession;
}) {
  const controller = useRef<StaffWriteController | null>(null),
    client = useRef<StaffDirectoryClient | null>(null),
    raw = useRef(''),
    precheck = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<StaffWriteController['snapshot']> | null>(
      null,
    ),
    [invitation, setInvitation] = useState(''),
    [code, setCode] = useState(''),
    [replay, setReplay] = useState(false),
    [reading, setReading] = useState(false),
    [denied, setDenied] = useState(false),
    [message, setMessage] = useState('');
  const sync = () => {
    if (controller.current) setSnapshot(controller.current.snapshot());
  };
  const discardCode = () => {
    raw.current = '';
    setCode('');
  };
  useEffect(() => {
    let live = true;
    const api = createStaffDirectoryClient({ instanceId }, async (...args) => {
      const response = await fetch(...args);
      if (live && (response.status === 401 || response.status === 403)) {
        controller.current?.close();
        raw.current = '';
        setCode('');
        setDenied(true);
      }
      return response;
    });
    client.current = api;
    try {
      const c = createStaffWriteController({
        scope: { instanceId, tenantId: session.tenantId, actorId: session.actorId },
        store: window.sessionStorage,
        client: api,
      });
      controller.current = c;
      if (c.snapshot().attempt && c.snapshot().attempt!.kind !== 'acceptance') {
        c.close();
        setDenied(true);
      }
      sync();
    } catch {
      setMessage('Retained operation storage is unavailable. No acceptance can start.');
    }
    const before = (event: BeforeUnloadEvent) => {
      if (raw.current || !controller.current?.snapshot().canNavigate) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const links = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        target &&
        !target.hasAttribute('data-recipient-reverify') &&
        (raw.current || !controller.current?.snapshot().canNavigate)
      ) {
        event.preventDefault();
        setMessage('Discard the code draft and recover any uncertain acceptance before leaving.');
      }
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', links, true);
    return () => {
      live = false;
      raw.current = '';
      precheck.current?.abort();
      controller.current?.close();
      controller.current = null;
      client.current = null;
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', links, true);
    };
  }, [instanceId, session.tenantId, session.actorId, session.recipientEmail]);
  const attempt = snapshot?.attempt,
    locked = !snapshot || snapshot.busy || snapshot.blocked || snapshot.closed || reading || denied;
  function prepare(event: FormEvent) {
    event.preventDefault();
    if (locked || attempt) return;
    try {
      controller.current!.prepare('acceptance', {
        policy: 'staff-invitation-redemption-command-v1',
        invitationId: invitation,
        operationId: crypto.randomUUID(),
      });
      setMessage('Review the retained invitation and verified recipient, then accept explicitly.');
      sync();
    } catch {
      setMessage('Enter the exact invitation ID. An uncertain request cannot be replaced.');
    }
  }
  async function run(kind: 'submit' | 'recover' | 'replay') {
    const c = controller.current,
      api = client.current;
    if (!c || !api || locked || attempt?.kind !== 'acceptance') return;
    const material = code,
      abort = new AbortController();
    precheck.current = abort;
    setReading(true);
    try {
      const current = await api.getInvitationRecipientSession(abort.signal);
      if (controller.current !== c || c.snapshot().closed || abort.signal.aborted) return;
      if (
        current.tenantId !== session.tenantId ||
        current.actorId !== session.actorId ||
        current.recipientEmail !== session.recipientEmail
      ) {
        c.close();
        discardCode();
        setDenied(true);
        throw Error();
      }
      // Raw material never enters the retained command, snapshot or storage.
      if (kind !== 'recover') discardCode();
      const pending =
        kind === 'recover'
          ? c.recover()
          : kind === 'replay'
            ? c.replay(replay, material)
            : c.submit(material);
      sync();
      await pending;
      if (controller.current === c && !c.snapshot().closed)
        setMessage(
          'The original acceptance receipt is verified. It records a past grant; it does not restore later revoked access.',
        );
    } catch {
      if (controller.current === c)
        setMessage(
          c.snapshot().attempt?.phase === 'prepared'
            ? 'Acceptance has not been submitted. Verify the recipient session and exact code, then review again.'
            : c.snapshot().attempt?.phase === 'refused'
              ? 'Acceptance was refused without a write. Acknowledge the refusal and review the invitation.'
              : 'Acceptance is not confirmed. Keep this operation and recover the original by GET. No automatic retry was made.',
        );
    } finally {
      if (precheck.current === abort) precheck.current = null;
      if (controller.current === c) {
        setReading(false);
        sync();
      }
    }
  }
  if (denied)
    return (
      <section role="alert">
        <h2>Verified recipient unavailable</h2>
        <p>
          Private recipient details and code drafts are hidden. Uncertain operation metadata remains
          retained.
        </p>
        <a href="/invitations/accept" data-recipient-reverify>
          Reload and verify recipient
        </a>
      </section>
    );
  return (
    <div className="staff-workspace">
      <section>
        <h2>Verified recipient</h2>
        <p>{session.recipientEmail}</p>
        <p>
          Company {session.tenantId}. Identity verification alone grants no staff role or
          membership.
        </p>
      </section>
      <p role="status" aria-live="polite">
        {message ||
          'Use the invitation ID and private code supplied for this verified email. The code is never stored with a retained operation.'}
      </p>
      {!snapshot ? (
        <p>Opening retained acceptance storage…</p>
      ) : snapshot.blocked || snapshot.closed ? (
        <p role="alert">Storage or current scope cannot be verified. No acceptance can start.</p>
      ) : attempt?.kind === 'acceptance' ? (
        <section className="staff-recovery">
          <h2>Retained acceptance · {attempt.phase}</h2>
          <p>Operation {attempt.command.operationId}</p>
          <p>Invitation {attempt.command.invitationId}</p>
          <details>
            <summary>Review exact retained request</summary>
            <pre>{JSON.stringify(attempt.command, null, 2)}</pre>
          </details>
          {attempt.phase === 'prepared' && (
            <button disabled={locked || !code} onClick={() => void run('submit')}>
              Accept reviewed invitation
            </button>
          )}
          {attempt.phase === 'uncertain' && (
            <>
              <p>Do not create a replacement or discard an uncertain operation.</p>
              <button disabled={locked} onClick={() => void run('recover')}>
                Recover original acceptance by GET
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={replay}
                  onChange={(e) => setReplay(e.target.checked)}
                />
                I explicitly want to replay this exact acceptance
              </label>
              <button disabled={locked || !replay || !code} onClick={() => void run('replay')}>
                Replay exact acceptance
              </button>
            </>
          )}
          {attempt.receipt && (
            <p>
              Original membership grant: {attempt.receipt.requestedRole} · member{' '}
              {attempt.receipt.memberId}. This is a historical receipt, not a current access check.
            </p>
          )}
          {attempt.phase !== 'uncertain' && (
            <button
              disabled={locked || !!code}
              onClick={() => {
                try {
                  controller.current!.clear();
                  setInvitation('');
                  setReplay(false);
                  setMessage('Retained operation cleared explicitly.');
                  sync();
                } catch {
                  setMessage('Retained storage could not be verified.');
                }
              }}
            >
              {attempt.phase === 'refused'
                ? 'Acknowledge refusal and clear request'
                : attempt.phase === 'resolved'
                  ? 'Acknowledge and clear acceptance'
                  : 'Discard undispatched acceptance'}
            </button>
          )}
        </section>
      ) : (
        <form onSubmit={prepare}>
          <fieldset disabled={locked}>
            <legend>Review invitation</legend>
            <label>
              Invitation ID
              <input
                value={invitation}
                onChange={(e) => setInvitation(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <button>Prepare acceptance request</button>
          </fieldset>
        </form>
      )}
      {(!attempt ||
        (attempt.kind === 'acceptance' && ['prepared', 'uncertain'].includes(attempt.phase))) && (
        <section>
          <h2>Private invitation code</h2>
          <label>
            Invitation code
            <input
              type="password"
              value={code}
              onChange={(e) => {
                raw.current = e.target.value;
                setCode(e.target.value);
              }}
              disabled={locked}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button disabled={!code || reading || snapshot?.busy} onClick={discardCode}>
            Discard code draft
          </button>
          <p>
            The code is cleared from this form when submitted. Reload recovery uses operation
            metadata, never a saved code.
          </p>
        </section>
      )}
    </div>
  );
}
