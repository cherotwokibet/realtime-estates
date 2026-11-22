'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { authChangeEffect } from '@realtor/browser-auth/events';
import { validateInvitationRecipientLease, type InvitationRecipientLease } from '@realtor/domain';
import { createBoundedPrivateLease } from '../lib/bounded-private-lease.ts';
import { readInvitationRecipientLease } from '../lib/invitation-recipient-lease-client.ts';
import InvitationAcceptanceWorkspace from './InvitationAcceptanceWorkspace.tsx';
import { ClearRecipient } from '../lib/recipient-private-context.tsx';
export default function InvitationRecipientBoundary({ instanceId }: { instanceId: string }) {
  const [identity, setIdentity] = useState<InvitationRecipientLease | null>(null),
    [closed, setClosed] = useState(false);
  const done = useRef(false),
    cleanup = useRef<() => void>(() => {});
  const clear = useCallback(() => {
    if (done.current) return;
    done.current = true;
    cleanup.current();
    setIdentity(null);
    setClosed(true);
  }, []);
  useEffect(() => {
    if (done.current) return;
    let checked: InvitationRecipientLease | null = null;
    const lease = createBoundedPrivateLease<InvitationRecipientLease>({
      read: async (signal) => {
        const value = await readInvitationRecipientLease(instanceId, signal);
        checked = value;
        return value;
      },
      validate: validateInvitationRecipientLease,
      matches: () => true,
      fingerprint: (value) =>
        JSON.stringify([value.tenantId, value.actorId, value.recipientEmail, value.authority]),
      onReady: () => {
        if (!done.current && checked) setIdentity(checked);
      },
      onClose: clear,
      foreground: () => document.visibilityState === 'visible',
    });
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('realtor-hosted-auth-v1');
    if (channel)
      channel.onmessage = (event) => {
        if (authChangeEffect(event.data) !== 'ignore') flushSync(() => lease.invalidate());
      };
    const hide = () => flushSync(() => lease.invalidate());
    const foreground = () => {
      if (document.visibilityState === 'visible')
        flushSync(() => {
          void lease.refresh();
        });
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    const dispose = () => {
      lease.dispose();
      channel?.close();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
    cleanup.current = dispose;
    void lease.refresh();
    return () => {
      dispose();
      if (cleanup.current === dispose) cleanup.current = () => {};
    };
  }, [instanceId, clear]);
  if (closed)
    return (
      <section aria-label="Recipient view closed">
        <h2>Recipient view closed</h2>
        <p>
          Recipient access changed or this page was left. Any uncertain operation metadata remains
          retained. Reload to verify the current recipient before continuing.
        </p>
        <button onClick={() => window.location.reload()}>Reload recipient access</button>
      </section>
    );
  if (!identity)
    return (
      <section aria-label="Checking recipient access">
        <p role="status">Checking current recipient identity…</p>
      </section>
    );
  const session = {
    policy: 'synthetic-staff-invitation-recipient-session-v1' as const,
    tenantId: identity.tenantId,
    actorId: identity.actorId,
    recipientEmail: identity.recipientEmail,
    authority: 'identity_only' as const,
  };
  return (
    <ClearRecipient.Provider value={clear}>
      <InvitationAcceptanceWorkspace instanceId={instanceId} session={session} />
    </ClearRecipient.Provider>
  );
}
