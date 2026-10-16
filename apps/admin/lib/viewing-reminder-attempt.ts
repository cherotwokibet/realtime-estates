import {
  validateViewingReminderAdmissionCommand,
  validateViewingReminderAdmissionReceipt,
  validateViewingReminderAdmissionSnapshot,
  validateViewingReminderCaptureCommand,
  validateViewingReminderCaptureReceipt,
  type ViewingReminderAdmissionCommand,
  type ViewingReminderAdmissionReceipt,
  type ViewingReminderCaptureCommand,
  type ViewingReminderCaptureReceipt,
} from '@realtor/api-client';
import { EnquiryPreviewError, type EnquiryPreviewClient } from './enquiry-client.ts';
export interface ReminderAttempt<O, R> {
  readonly original: O;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: R | null;
  submit(signal?: AbortSignal): Promise<R>;
  recoverOriginal(signal?: AbortSignal): Promise<R>;
  replayOriginal(signal?: AbortSignal): Promise<R>;
}
/** Exact original lives only in memory. Recovery cannot mutate or replace it. */
function attempt<O, R>(
  original: O,
  save: (signal?: AbortSignal) => Promise<R>,
  recover: (signal?: AbortSignal) => Promise<R>,
  validate: (input: unknown) => R,
): ReminderAttempt<O, R> {
  let status: ReminderAttempt<O, R>['status'] = 'ready',
    receipt: R | null = null;
  async function run(mode: 'submit' | 'recover' | 'replay', signal?: AbortSignal): Promise<R> {
    if (
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      status !== (mode === 'submit' ? 'ready' : 'uncertain')
    )
      throw new EnquiryPreviewError('validation');
    const wasUncertain = status === 'uncertain';
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : save)(signal);
      try {
        receipt = validate(value);
      } catch {
        throw new EnquiryPreviewError('response', 200, mode !== 'recover');
      }
      status = 'received';
      return receipt;
    } catch (error) {
      status =
        wasUncertain || !(error instanceof EnquiryPreviewError) || error.uncertain
          ? 'uncertain'
          : 'rejected';
      throw error;
    }
  }
  return Object.freeze({
    original,
    get status() {
      return status;
    },
    get receipt() {
      return receipt;
    },
    submit: (signal?: AbortSignal) => run('submit', signal),
    recoverOriginal: (signal?: AbortSignal) => run('recover', signal),
    replayOriginal: (signal?: AbortSignal) => run('replay', signal),
  });
}
export function prepareViewingReminderAdmissionAttempt(
  client: Pick<EnquiryPreviewClient, 'admitViewingReminder' | 'recoverViewingReminderAdmission'>,
  enquiryInput: string,
  viewingInput: string,
  input: ViewingReminderAdmissionCommand,
) {
  let command: ViewingReminderAdmissionCommand;
  const valid = (value: unknown) =>
    typeof value === 'string' &&
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  try {
    if (!valid(enquiryInput) || !valid(viewingInput)) throw new Error();
    command = validateViewingReminderAdmissionCommand(input);
  } catch {
    throw new EnquiryPreviewError('validation');
  }
  const enquiryId = enquiryInput.toLowerCase(),
    viewingId = viewingInput.toLowerCase(),
    original = Object.freeze({ enquiryId, viewingId, command }),
    save = client.admitViewingReminder.bind(client),
    recover = client.recoverViewingReminderAdmission.bind(client);
  return attempt(
    original,
    (signal) => save(enquiryId, viewingId, command, signal),
    (signal) => recover(enquiryId, viewingId, command, signal),
    (value) => validateViewingReminderAdmissionReceipt(value, enquiryId, viewingId, command),
  );
}
export function prepareViewingReminderCaptureAttempt(
  client: Pick<EnquiryPreviewClient, 'captureViewingReminder' | 'recoverViewingReminderCapture'>,
  input: ViewingReminderAdmissionReceipt,
  commandInput: ViewingReminderCaptureCommand,
) {
  let admission: ViewingReminderAdmissionReceipt, command: ViewingReminderCaptureCommand;
  try {
    admission = validateViewingReminderAdmissionSnapshot(input);
    if (admission.outcome !== 'admitted') throw new Error();
    command = validateViewingReminderCaptureCommand(commandInput);
  } catch {
    throw new EnquiryPreviewError('validation');
  }
  const original = Object.freeze({ admission, command }),
    save = client.captureViewingReminder.bind(client),
    recover = client.recoverViewingReminderCapture.bind(client);
  return attempt(
    original,
    (signal) => save(admission, command, signal),
    (signal) => recover(admission, command, signal),
    (value) => validateViewingReminderCaptureReceipt(value, admission, command),
  );
}
