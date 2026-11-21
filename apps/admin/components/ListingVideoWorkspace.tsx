'use client';
import PrivateWorkspaceBoundary, { usePrivateWorkspaceClear } from './PrivateWorkspaceBoundary.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '@realtor/api-client';
import { validateListingVideoCommand, type ListingVideo } from '@realtor/domain';
import { videoSession, videoAttempt } from '../lib/listing-video-session.ts';
import { createListingVideoClient } from '../lib/listing-video-client.ts';
import type { ListingVideoScreen } from '../lib/listing-video-screen.ts';
type Attempt = ReturnType<typeof videoAttempt>;
export default function ListingVideoWorkspace(props: ListingVideoScreen) {
  const scope = [
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.scope.listingId,
    props.scope.revision,
  ].join(':');
  return (
    <PrivateWorkspaceBoundary key={scope}>
      <ListingVideoSession {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function ListingVideoSession(props: ListingVideoScreen) {
  const clearPrivateWorkspace = usePrivateWorkspaceClear();
  const client = useMemo(
    () => createListingVideoClient(props.scope),
    [
      props.scope.instanceId,
      props.scope.tenantId,
      props.scope.actorId,
      props.scope.listingId,
      props.scope.revision,
    ],
  );
  const current = useRef<Attempt | null>(null),
    generation = useRef(0),
    request = useRef<AbortController | null>(null);
  const [provider, setProvider] = useState<'youtube' | 'vimeo'>(
      props.state.video?.provider ?? 'youtube',
    ),
    [identifier, setIdentifier] = useState(props.state.video?.videoId ?? ''),
    [title, setTitle] = useState(props.state.video?.title ?? ''),
    [remove, setRemove] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [lost, setLost] = useState(false),
    [message, setMessage] = useState(''),
    [retry, setRetry] = useState(false),
    [, redraw] = useState(0);
  useEffect(() => {
    const turn = ++generation.current;
    current.current = null;
    setReady(false);
    setBlocked(false);
    setLost(false);
    try {
      const saved = videoSession(window.sessionStorage, props.scope).load();
      if (saved)
        current.current = videoAttempt(
          window.sessionStorage,
          props.scope,
          client,
          saved.command,
          true,
        );
      setReady(true);
      setMessage(
        saved
          ? 'An original was retained. Check it explicitly before preparing another change.'
          : 'Review a private selection before saving.',
      );
    } catch {
      setBlocked(true);
      setMessage(
        'Retained data is unavailable or belongs to another session. Keep it and return to its original identity.',
      );
    }
    return () => {
      if (generation.current === turn) {
        generation.current++;
        request.current?.abort();
      }
    };
  }, [client, props.scope]);
  function prepare() {
    try {
      if (current.current || !ready || busy || blocked || !props.editable) return;
      const video: ListingVideo | null = remove ? null : { provider, videoId: identifier, title };
      const command = validateListingVideoCommand({
        policy: 'synthetic-listing-video-command-v1',
        operationId: crypto.randomUUID(),
        listingId: props.scope.listingId,
        revision: props.scope.revision,
        expectedVersion: props.state.version,
        video,
      });
      current.current = videoAttempt(window.sessionStorage, props.scope, client, command);
      setMessage('Review this exact original. It is retained before any request.');
      redraw((n) => n + 1);
    } catch {
      setMessage(
        'Check the provider identifier/title and settle any retained draft or transition first.',
      );
    }
  }
  async function run(mode: 'send' | 'recover' | 'replay') {
    if (busy || !current.current || lost) return;
    const turn = generation.current;
    request.current = new AbortController();
    setBusy(true);
    setRetry(false);
    try {
      const a = current.current;
      await (mode === 'send'
        ? a.send(request.current.signal)
        : mode === 'recover'
          ? a.recover(request.current.signal)
          : a.replay(request.current.signal));
      if (turn === generation.current)
        setMessage('The exact original is confirmed. Clear it and load a fresh saved revision.');
    } catch (e) {
      if (turn !== generation.current) return;
      if (e instanceof ApiClientError && [401, 403].includes(e.status ?? 0))
        clearPrivateWorkspace();
      if (e instanceof ApiClientError && [401, 403].includes(e.status ?? 0)) {
        setLost(true);
        setMessage(
          'Current access is unavailable. Private details are hidden; the original is retained.',
        );
      } else
        setMessage(
          current.current?.status === 'refused'
            ? 'The change was refused without a confirmed write. Acknowledge the retained refusal.'
            : 'The result is unconfirmed. Keep the original and check it explicitly.',
        );
    } finally {
      if (turn === generation.current) {
        setBusy(false);
        redraw((n) => n + 1);
      }
    }
  }
  function clear() {
    try {
      const a = current.current;
      if (!a) return;
      const reload = a.status !== 'prepared';
      a.clear();
      current.current = null;
      setMessage('Original cleared.');
      redraw((n) => n + 1);
      if (reload) window.location.reload();
    } catch {
      setBlocked(true);
      setMessage('Keep the original; storage could not confirm acknowledgement.');
    }
  }
  if (lost)
    return (
      <section className="draft-panel">
        <h1>Private video unavailable</h1>
        <p role="alert">{message}</p>
        <p>Return with current access to recover the retained original.</p>
      </section>
    );
  const a = current.current,
    locked = !ready || busy || blocked || !!a || !props.editable;
  return (
    <section className="draft-panel" aria-labelledby="video-title">
      <h1 id="video-title">Private listing video</h1>
      <p>
        Save a provider identifier for later review. This selection stays private; it does not embed
        a player or contact a video provider.
      </p>
      <p>
        Saved revision {props.scope.revision} · version {props.state.version}
      </p>
      <p>
        Current selection:{' '}
        {props.state.video
          ? `${props.state.video.provider} · ${props.state.video.title} · ${props.state.video.videoId}`
          : 'None'}
      </p>
      {!props.editable && (
        <p role="note">
          This saved revision is read-only. Retained originals can still be checked.
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <fieldset disabled={locked}>
        <legend>New selection</legend>
        <label className="draft-field">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'youtube' | 'vimeo')}
          >
            <option value="youtube">YouTube</option>
            <option value="vimeo">Vimeo</option>
          </select>
        </label>
        <label className="draft-field">
          Video identifier
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
          />
          <small>Use the identifier only, without a URL, tracking parameters or embed code.</small>
        </label>
        <label className="draft-field">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={240}
            autoComplete="off"
          />
        </label>
        <label className="draft-checkbox">
          <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
          Remove the current selection
        </label>
        <button className="draft-secondary" type="button" onClick={prepare}>
          Review video change
        </button>
      </fieldset>
      {a && (
        <section className="draft-panel" aria-labelledby="video-original">
          <h2 id="video-original">Retained video original</h2>
          <dl style={{ overflowWrap: 'anywhere' }}>
            <dt>Operation</dt>
            <dd>{a.command.operationId}</dd>
            <dt>Saved version expected</dt>
            <dd>{a.command.expectedVersion}</dd>
            <dt>Selection</dt>
            <dd>
              {a.command.video
                ? `${a.command.video.provider} · ${a.command.video.videoId} · ${a.command.video.title}`
                : 'Remove the selection'}
            </dd>
            <dt>State</dt>
            <dd>{a.status}</dd>
          </dl>
          {a.status === 'prepared' && (
            <>
              <button
                className="draft-secondary"
                type="button"
                disabled={busy}
                onClick={() => void run('send')}
              >
                Save reviewed video change
              </button>
              <button className="draft-secondary" type="button" disabled={busy} onClick={clear}>
                Revise unsent change
              </button>
            </>
          )}
          {a.status === 'uncertain' && (
            <>
              <button
                className="draft-secondary"
                type="button"
                disabled={busy}
                onClick={() => void run('recover')}
              >
                Check original video request
              </button>
              <label className="draft-checkbox">
                <input
                  type="checkbox"
                  checked={retry}
                  disabled={busy}
                  onChange={(e) => setRetry(e.target.checked)}
                />
                I want to retry this exact original; it may already have been saved.
              </label>
              <button
                className="draft-secondary"
                type="button"
                disabled={busy || !retry}
                onClick={() => void run('replay')}
              >
                Retry exact video original
              </button>
            </>
          )}
          {(a.status === 'resolved' || a.status === 'refused') && (
            <button className="draft-secondary" type="button" disabled={busy} onClick={clear}>
              {a.status === 'resolved'
                ? 'Clear confirmed original and refresh'
                : 'Acknowledge refused original and refresh'}
            </button>
          )}
        </section>
      )}
      <p>
        Video selections do not count as accepted listing photos. Floor plans and public video
        display are still being built.
      </p>
    </section>
  );
}
