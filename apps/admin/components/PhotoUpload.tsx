'use client';
import { useRef, useState } from 'react';
import type {
  MediaRegistrationReceiptV2,
  MediaAttachIntentV2,
  StaffDraftWorkspaceV2,
} from '@realtor/api-client';
import {
  createPhotoCommand,
  matchPhotoRegistration,
  matchPhotoStatus,
  matchPhotoAttachment,
  type PhotoCommand,
} from '../lib/photo-model';

type Phase =
  | 'registration_unknown'
  | 'registered'
  | 'upload_unknown'
  | 'verified'
  | 'intent_unknown'
  | 'ready'
  | 'finalize_unknown'
  | 'terminal'
  | 'refused'
  | 'blocked';
interface Work {
  command: PhotoCommand;
  phase: Phase;
  registration: MediaRegistrationReceiptV2 | null;
  attachment: MediaAttachIntentV2 | null;
  imageVerified: boolean;
}
interface Props {
  workspace: StaffDraftWorkspaceV2;
  instanceId: string;
  enabled: boolean;
  busy: boolean;
  unavailable: boolean;
  onLock: (locked: boolean) => void;
  begin: () => boolean;
  end: () => void;
  onCompare: () => Promise<void>;
}
type Failure = { status: number; uncertain: boolean };
async function photoRequest(
  path: string,
  instance: string,
  method = 'GET',
  body?: unknown,
  binary?: File,
): Promise<unknown> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 35000);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'X-Preview-Instance': instance,
          ...(binary
            ? { 'Content-Type': 'application/octet-stream' }
            : body
              ? { 'Content-Type': 'application/json' }
              : {}),
        },
        ...(binary ? { body: binary } : body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw { status: 0, uncertain: method !== 'GET' } satisfies Failure;
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw { status: response.status, uncertain: method !== 'GET' } satisfies Failure;
    }
    if (!response.ok)
      throw {
        status: response.status,
        uncertain:
          (data as { submissionUncertain?: boolean })?.submissionUncertain === true ||
          response.status >= 500,
      } satisfies Failure;
    return data;
  } finally {
    clearTimeout(timer);
  }
}
export default function PhotoUpload(props: Props) {
  const [file, setFile] = useState<File | null>(null),
    [alt, setAlt] = useState(''),
    [work, setWork] = useState<Work | null>(null),
    [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null),
    workRef = useRef<Work | null>(null);
  const path = `/api/staff/drafts/${props.workspace.listingId}/${props.workspace.draft.revision}`;
  const call = (target: string, method = 'GET', body?: unknown, binary?: File) =>
    photoRequest(path + target, props.instanceId, method, body, binary);
  const put = (next: Work) => {
    workRef.current = next;
    setWork(next);
  };
  const disabled =
    props.busy ||
    props.unavailable ||
    props.workspace.draft.state !== 'draft' ||
    props.workspace.photos.length >= 12;
  async function prepare() {
    if (workRef.current || disabled || !file) return;
    if (
      file.size < 1 ||
      file.size > 10 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      setMessage('Choose one synthetic JPEG, PNG or WebP image, up to 10 MiB.');
      return;
    }
    let command: PhotoCommand;
    try {
      command = createPhotoCommand(
        props.workspace,
        alt,
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      );
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }
    if (!props.begin()) return;
    props.onLock(true);
    const initial: Work = {
      command,
      phase: 'registration_unknown',
      registration: null,
      attachment: null,
      imageVerified: false,
    };
    put(initial);
    setMessage('Preparing this photo once…');
    try {
      const registration = matchPhotoRegistration(
        command,
        await call('/media-registrations', 'POST', {
          registrationId: command.registrationId,
          expectedVersion: command.expectedVersion,
          altText: command.altText,
        }),
      );
      put({ ...initial, registration, phase: 'registered' });
      setMessage('Photo request prepared. Upload and verify the selected image next.');
    } catch (error) {
      const failure = error as Failure;
      if (failure.status >= 400 && failure.status < 500 && !failure.uncertain) {
        put({ ...initial, phase: 'refused' });
        setMessage(
          'The preparation request was refused. Read the current saved gallery before continuing.',
        );
      } else
        setMessage(
          'Preparation may have reached the server. Check its original result; keep this tab open.',
        );
    } finally {
      props.end();
    }
  }
  async function upload() {
    const original = workRef.current;
    if (
      !original ||
      original.phase !== 'registered' ||
      !original.registration ||
      !file ||
      !props.begin()
    )
      return;
    const pending = { ...original, phase: 'upload_unknown' as const };
    put(pending);
    setMessage('Uploading and verifying this photo once…');
    try {
      const status = matchPhotoStatus(
        original.command,
        original.registration,
        await call(
          `/media-jobs/${original.registration.jobId}/uploads/${original.command.uploadId}`,
          'PUT',
          undefined,
          file,
        ),
      );
      put({
        ...pending,
        imageVerified: status.state === 'verified',
        phase:
          status.state === 'verified'
            ? 'verified'
            : status.state === 'native_failed'
              ? 'refused'
              : 'blocked',
      });
      setMessage(
        status.state === 'verified'
          ? 'Image verified. Add it to the saved draft when ready.'
          : status.state === 'native_failed'
            ? 'Image conversion failed with a confirmed stopped worker. Read the current gallery before choosing another photo.'
            : 'Verification is unresolved. Check the original upload status; another conversion will not be started.',
      );
    } catch {
      setMessage(
        'The upload result is uncertain. Check the original upload; do not send the image again.',
      );
    } finally {
      props.end();
    }
  }
  async function attach() {
    let original = workRef.current;
    if (
      !original ||
      !original.registration ||
      !['verified', 'ready'].includes(original.phase) ||
      !props.begin()
    )
      return;
    try {
      if (original.phase === 'verified') {
        const pending = { ...original, phase: 'intent_unknown' as const };
        put(pending);
        setMessage('Preparing the exact saved-version attachment…');
        const attachment = matchPhotoAttachment(
          original.command,
          original.registration,
          await call('/media-attach-intents', 'POST', {
            operationId: original.command.operationId,
            jobId: original.registration.jobId,
            expectedVersion: original.command.expectedVersion,
          }),
        );
        original = {
          ...pending,
          attachment,
          phase: attachment.status === 'ready' ? 'ready' : 'terminal',
        };
        put(original);
      }
      if (original.phase === 'ready') {
        put({ ...original, phase: 'finalize_unknown' });
        setMessage('Adding the verified photo to its original saved version…');
        const attachment = matchPhotoAttachment(
          original.command,
          original.registration!,
          await call(`/media-attach-intents/${original.command.operationId}/finalize`, 'POST'),
        );
        put({
          ...original,
          attachment,
          phase: attachment.status === 'ready' ? 'finalize_unknown' : 'terminal',
        });
        setMessage(
          attachment.status === 'applied'
            ? 'Photo attached. Read the current gallery, then explicitly continue with that saved version.'
            : attachment.status === 'ready'
              ? 'Attachment is not confirmed. Check its original result before another change.'
              : 'The original attachment did not apply. Read the current gallery to compare.',
        );
      }
    } catch (error) {
      const failure = error as Failure;
      if (failure.status >= 400 && failure.status < 500 && !failure.uncertain) {
        const retained = workRef.current!;
        put({ ...retained, phase: 'refused' });
        setMessage(
          'The attachment request was refused. Read and compare the current gallery; your text edits are retained.',
        );
      } else
        setMessage(
          'The attachment request may have reached the server. Check its original result before another change.',
        );
    } finally {
      props.end();
    }
  }
  async function recover() {
    let original = workRef.current;
    if (!original || !props.begin()) return;
    try {
      if (original.phase === 'registration_unknown') {
        const registration = matchPhotoRegistration(
          original.command,
          await call(`/media-registrations/${original.command.registrationId}`),
        );
        original = { ...original, registration, phase: 'registered' };
        put(original);
        setMessage('Original preparation recovered. The selected image can now be uploaded once.');
      } else if (['upload_unknown', 'blocked'].includes(original.phase) && original.registration) {
        const status = matchPhotoStatus(
          original.command,
          original.registration,
          await call(
            `/media-jobs/${original.registration.jobId}/uploads/${original.command.uploadId}`,
          ),
        );
        original = {
          ...original,
          imageVerified: status.state === 'verified',
          phase:
            status.state === 'verified'
              ? 'verified'
              : status.state === 'native_failed'
                ? 'refused'
                : 'blocked',
        };
        put(original);
        setMessage(
          status.state === 'verified'
            ? 'Original image verification recovered. It can now be attached.'
            : status.state === 'native_failed'
              ? 'Original conversion failed with a confirmed stopped worker. Read the current gallery before choosing another photo.'
              : 'Original upload remains unresolved. Keep this request; no replacement conversion will be started.',
        );
      } else if (
        ['intent_unknown', 'finalize_unknown'].includes(original.phase) &&
        original.registration
      ) {
        const attachment = matchPhotoAttachment(
          original.command,
          original.registration,
          await call(`/media-attach-intents/${original.command.operationId}`),
        );
        const phase =
          attachment.status !== 'ready'
            ? 'terminal'
            : original.phase === 'intent_unknown'
              ? 'ready'
              : 'finalize_unknown';
        original = { ...original, attachment, phase };
        put(original);
        setMessage(
          phase === 'ready'
            ? 'Original attachment request recovered. Finish adding this photo explicitly.'
            : phase === 'terminal'
              ? 'Original attachment result recovered. Read and compare the current gallery.'
              : 'Attachment is still unconfirmed. Checking its result does not repeat the command.',
        );
      } else if (['terminal', 'refused'].includes(original.phase)) {
        await props.onCompare();
        setMessage(
          'Current gallery loaded in the comparison panel. Choose the saved version to continue.',
        );
      }
    } catch {
      setMessage(
        'The original result could not be verified. Keep this tab open and check again when access returns.',
      );
    } finally {
      props.end();
    }
  }
  if (!props.enabled)
    return (
      <p className="gallery-fixture">
        Adding photos is available in the explicitly enabled local synthetic photo preview.
      </p>
    );
  const stage = work?.phase,
    terminal = stage === 'terminal' || stage === 'refused';
  return (
    <div className="photo-upload" aria-labelledby="photo-upload-heading">
      <div className="photo-upload-heading">
        <span className="photo-upload-icon" aria-hidden="true">
          ↥
        </span>
        <div>
          <h3 id="photo-upload-heading">Add a property photo</h3>
          <p>Choose one image, verify it, then add it to the saved draft.</p>
        </div>
      </div>
      {!work ? (
        <>
          <div className="photo-upload-fields">
            <label className="draft-field">
              Synthetic photo
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={disabled}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setMessage('');
                }}
              />
              <small>JPEG, PNG or WebP · maximum 10 MiB · fictional test images only</small>
            </label>
            <label className="draft-field">
              Photo description
              <input
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                disabled={disabled}
                maxLength={600}
                placeholder="For example, bright living room with a balcony"
                autoComplete="off"
              />
              <small>Describe what someone can see, in up to 300 characters.</small>
            </label>
          </div>
          <button
            type="button"
            className="draft-primary"
            disabled={disabled || !file || !alt.trim()}
            onClick={() => void prepare()}
          >
            Prepare photo
          </button>
        </>
      ) : (
        <>
          <ol className="photo-steps" aria-label="Photo progress">
            <li>1 · {work.registration ? 'Prepared' : 'Preparation needs checking'}</li>
            <li>2 · {work.imageVerified ? 'Image verified' : 'Image verification'}</li>
            <li>
              3 ·{' '}
              {work.attachment?.status === 'applied'
                ? 'Attached'
                : terminal
                  ? 'Original result recorded'
                  : 'Add to saved draft'}
            </li>
          </ol>
          <p className="photo-file">
            {file?.name ?? 'Selected image'} · saved version {work.command.expectedVersion}
          </p>
          {stage === 'registered' && (
            <button
              type="button"
              className="draft-primary"
              disabled={props.busy}
              onClick={() => void upload()}
            >
              Upload and verify image
            </button>
          )}
          {(stage === 'verified' || stage === 'ready') && (
            <button
              type="button"
              className="draft-primary"
              disabled={props.busy}
              onClick={() => void attach()}
            >
              {stage === 'ready' ? 'Finish adding this photo' : 'Add verified photo to draft'}
            </button>
          )}
          {!['registered', 'verified', 'ready'].includes(stage!) && (
            <button
              type="button"
              className="draft-secondary"
              disabled={props.busy}
              onClick={() => void recover()}
            >
              {terminal ? 'Read current gallery' : 'Check original photo result'}
            </button>
          )}
          <p className="draft-help">
            Your text edits stay in this tab. Other saved changes are paused until this original
            photo request is resolved.
          </p>
        </>
      )}
      {message && (
        <p className="photo-message" role="status" aria-live="polite">
          {message}
        </p>
      )}
      <p className="draft-help">
        After adding a photo, read and explicitly use the current gallery to display it. Existing
        synthetic metadata cards have no image bytes.
      </p>
    </div>
  );
}
