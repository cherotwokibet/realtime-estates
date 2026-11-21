'use client';
import PrivateWorkspaceBoundary, { usePrivateWorkspaceClear } from './PrivateWorkspaceBoundary.tsx';
import { ApiClientError } from '@realtor/api-client';
import FloorPlanImage from './FloorPlanImage.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  floorPlanSession,
  floorPlanAttempt,
  assertFloorPlanOtherOriginalsClear,
} from '../lib/floor-plan-session.ts';
import { createFloorPlanClient } from '../lib/floor-plan-client.ts';
import type { readFloorPlanScreen } from '../lib/floor-plan-server.ts';
type Screen = Awaited<ReturnType<typeof readFloorPlanScreen>>;
type Attempt = ReturnType<typeof floorPlanAttempt>;
export default function FloorPlanWorkspace(props: Screen) {
  const scope = [
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.scope.listingId,
    props.scope.revision,
  ].join(':');
  return (
    <PrivateWorkspaceBoundary
      access={{
        profile: 'staff',
        instanceId: props.scope.instanceId,
        tenantId: props.scope.tenantId,
        actorId: props.scope.actorId,
      }}
      key={scope}
    >
      <FloorPlanSession {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function FloorPlanSession(props: Screen) {
  const clearPrivateWorkspace = usePrivateWorkspaceClear();
  const client = useMemo(
    () => createFloorPlanClient(props.scope),
    [
      props.scope.instanceId,
      props.scope.tenantId,
      props.scope.actorId,
      props.scope.listingId,
      props.scope.revision,
    ],
  );
  const current = useRef<Attempt | null>(null),
    request = useRef<AbortController | null>(null),
    generation = useRef(0);
  const [ready, setReady] = useState(false),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [message, setMessage] = useState('Checking this tab for an original request…'),
    [, redraw] = useState(0);
  useEffect(() => {
    generation.current++;
    current.current = null;
    setReady(false);
    setBusy(false);
    request.current = null;
    setBlocked(false);
    setFile(null);
    try {
      const saved = floorPlanSession(window.sessionStorage, props.scope).load();
      if (saved)
        current.current = floorPlanAttempt(
          window.sessionStorage,
          props.scope,
          client,
          saved.command,
          true,
        );
      else assertFloorPlanOtherOriginalsClear(window.sessionStorage, props.scope);
      setReady(true);
      setMessage(
        saved
          ? 'Original request retained. Recover an uncertain result before making another change.'
          : 'Choose a PNG or JPEG floor plan up to 10 MiB.',
      );
    } catch {
      setBlocked(true);
      setMessage(
        'Another, changed or unreadable original is retained. Resolve it in its workspace; it has not been erased.',
      );
    }
    redraw((n) => n + 1);
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [client, props.scope, props.state.version]);
  const attempt = current.current,
    active = attempt !== null,
    status = attempt?.status,
    prepared =
      attempt?.receipt?.policy === 'synthetic-floor-plan-prepared-v1' ? attempt.receipt : null;
  const fresh =
    props.editable && (!attempt || attempt.command.expectedVersion === props.state.version);
  function retain(remove = false) {
    try {
      if (!ready || blocked || busy || active || !props.editable) throw Error();
      if (!remove && (!file || file.size < 1 || file.size > 10485760)) throw Error();
      const common = {
        listingId: props.scope.listingId,
        revision: props.scope.revision,
        expectedVersion: props.state.version,
      };
      current.current = floorPlanAttempt(
        window.sessionStorage,
        props.scope,
        client,
        remove
          ? {
              ...common,
              policy: 'synthetic-floor-plan-attachment-command-v1',
              operationId: crypto.randomUUID(),
              requestId: null,
            }
          : {
              ...common,
              policy: 'synthetic-floor-plan-preparation-command-v1',
              requestId: crypto.randomUUID(),
            },
      );
      setMessage(
        remove
          ? 'Removal reviewed. Confirm the change to the saved draft.'
          : 'File preparation reviewed. Confirm upload to prepare the floor plan.',
      );
      redraw((n) => n + 1);
    } catch {
      setMessage(
        'Could not retain this request. Check the file and resolve other originals first.',
      );
    }
  }
  async function run(recover: boolean) {
    const original = current.current;
    if (!original || busy) return;
    const turn = generation.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage(recover ? 'Checking the original result…' : 'Sending the reviewed request…');
    try {
      let source: Uint8Array | undefined;
      if (!recover && original.command.policy === 'synthetic-floor-plan-preparation-command-v1') {
        if (!file || file.size < 1 || file.size > 10485760) throw Error('Choose file');
        source = new Uint8Array(await file.arrayBuffer());
        if (turn !== generation.current || controller.signal.aborted) return;
      }
      await (recover
        ? original.recover(controller.signal)
        : original.send(source, controller.signal));
      if (turn !== generation.current) return;
      setFile(null);
      setMessage(
        original.receipt?.policy === 'synthetic-floor-plan-prepared-v1'
          ? 'Floor plan prepared. Attach it to the saved draft when ready.'
          : 'Saved floor-plan change verified. Clear this settled original and reload the saved draft.',
      );
    } catch (error) {
      if (turn !== generation.current) return;
      if (error instanceof ApiClientError && [401, 403].includes(error.status ?? 0))
        clearPrivateWorkspace();
      setMessage(
        original.status === 'refused'
          ? 'This request was refused before a write. Clear it and inspect a fresh draft.'
          : original.status === 'prepared'
            ? 'The file could not be read; this reviewed request has not been sent.'
            : 'Result unconfirmed. Keep this original and use Check original result; do not upload again.',
      );
    } finally {
      if (turn === generation.current) {
        setBusy(false);
        request.current = null;
        redraw((n) => n + 1);
      }
    }
  }
  function handoff() {
    try {
      const a = current.current;
      if (!a || !prepared || !fresh) throw Error();
      current.current = a.handoff({
        policy: 'synthetic-floor-plan-attachment-command-v1',
        operationId: crypto.randomUUID(),
        listingId: props.scope.listingId,
        revision: props.scope.revision,
        expectedVersion: props.state.version,
        requestId: prepared.requestId,
      });
      setMessage('Attachment reviewed. Confirm it to update the saved draft.');
      redraw((n) => n + 1);
    } catch {
      setMessage(
        'Attachment could not be retained. Keep the prepared original and reload fresh access.',
      );
    }
  }
  function clear() {
    try {
      current.current?.clear();
      current.current = null;
      setFile(null);
      setMessage('Settled original cleared. Reload the saved draft before another change.');
      setReady(false);
      redraw((n) => n + 1);
    } catch {
      setMessage('This original is still unconfirmed and has been kept.');
    }
  }
  return (
    <section className="draft-panel" aria-label="Private floor plan">
      <h1>Private floor plan</h1>
      <p>
        Saved revision {props.scope.revision} · version {props.state.version}
      </p>
      <p>
        {props.state.floorPlan
          ? `Saved floor plan: ${props.state.floorPlan.width} × ${props.state.floorPlan.height} pixels · ${props.state.floorPlan.bytes} bytes.`
          : 'Saved floor plan: None.'}
      </p>
      <FloorPlanImage
        key={JSON.stringify([props.scope, props.state])}
        scope={props.scope}
        state={props.state}
        audience={props.audience}
      />
      <p>Photos are separate. Preparing a file does not attach it or publish it.</p>
      {!props.editable && <p>This saved revision is read-only.</p>}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <fieldset disabled={!ready || blocked || busy || active || !props.editable}>
        <legend>Choose a floor plan</legend>
        <label htmlFor="floor-plan-file">PNG or JPEG file (maximum 10 MiB)</label>
        <input
          id="floor-plan-file"
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
        />
        <button className="draft-secondary" type="button" disabled={!file} onClick={() => retain()}>
          Review file preparation
        </button>
        <button
          className="draft-secondary"
          type="button"
          disabled={!props.state.floorPlan}
          onClick={() => retain(true)}
        >
          Review removal
        </button>
      </fieldset>
      {attempt && (
        <section aria-label="Original floor-plan request">
          <h2>
            {attempt.command.policy === 'synthetic-floor-plan-preparation-command-v1'
              ? 'File preparation original'
              : 'Attachment original'}
          </h2>
          <p>
            Original version {attempt.command.expectedVersion} · {status}
          </p>
          {status === 'prepared' && (
            <button
              className="draft-secondary"
              type="button"
              disabled={busy || !fresh}
              onClick={() => void run(false)}
            >
              Confirm reviewed request
            </button>
          )}
          {status === 'uncertain' && (
            <button
              className="draft-secondary"
              type="button"
              disabled={busy}
              onClick={() => void run(true)}
            >
              Check original result
            </button>
          )}
          {prepared && (
            <>
              <p>
                Prepared floor plan: {prepared.width} × {prepared.height} pixels · {prepared.bytes}{' '}
                bytes.
              </p>
              <button
                className="draft-secondary"
                type="button"
                disabled={busy || !fresh}
                onClick={handoff}
              >
                Review attachment to draft
              </button>
            </>
          )}
          {!fresh && status === 'resolved' && (
            <p>The draft has changed. Inspect the latest saved revision before another write.</p>
          )}
          {['prepared', 'resolved', 'refused'].includes(status ?? '') && (
            <button className="draft-secondary" type="button" disabled={busy} onClick={clear}>
              {status === 'prepared' ? 'Cancel unsent review' : 'Clear settled original'}
            </button>
          )}
        </section>
      )}
      <p>
        <a
          href={`/${props.audience === 'reviewer' ? 'reviews' : 'drafts'}/${props.scope.listingId}/${props.scope.revision}/floor-plan`}
        >
          Reload saved floor plan
        </a>
      </p>
    </section>
  );
}
