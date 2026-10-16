import {
  validateViewingTerminationCommand,
  validateViewingTerminationReceipt,
  type ViewingTerminationKind,
  type ViewingTerminationCommand,
  type ViewingTerminationReceipt,
} from '@realtor/api-client';
import { EnquiryPreviewError, type EnquiryPreviewClient } from './enquiry-client.ts';
export interface ViewingTerminationAttempt {
  readonly enquiryId: string;
  readonly original: Readonly<{
    kind: ViewingTerminationKind;
    viewingId: string;
    command: ViewingTerminationCommand;
  }>;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: ViewingTerminationReceipt | null;
  submit(signal?: AbortSignal): Promise<ViewingTerminationReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<ViewingTerminationReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<ViewingTerminationReceipt>;
}
/** Retain this exact selected viewing version and raw ending reason only in memory. */
export function prepareViewingTerminationAttempt(
  client: Pick<EnquiryPreviewClient, 'terminateViewing' | 'recoverViewingTermination'>,
  id: string,
  target: string,
  kind: ViewingTerminationKind,
  input: ViewingTerminationCommand,
): ViewingTerminationAttempt {
  let command: ViewingTerminationCommand;
  const valid = (value: unknown) =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  try {
    if (!valid(id) || !valid(target)) throw new Error();
    if (kind !== 'cancel' && kind !== 'decline') throw new Error();
    command = validateViewingTerminationCommand(input);
  } catch {
    throw new EnquiryPreviewError('validation');
  }
  const enquiryId = id.toLowerCase(),
    viewingId = target.toLowerCase(),
    original = Object.freeze({ kind, viewingId, command }),
    save = client.terminateViewing.bind(client),
    recover = client.recoverViewingTermination.bind(client);
  let status: ViewingTerminationAttempt['status'] = 'ready',
    receipt: ViewingTerminationReceipt | null = null;
  async function run(
    mode: 'submit' | 'recover' | 'replay',
    signal?: AbortSignal,
  ): Promise<ViewingTerminationReceipt> {
    if (
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      status !== (mode === 'submit' ? 'ready' : 'uncertain')
    )
      throw new EnquiryPreviewError('validation');
    const wasUncertain = status === 'uncertain';
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : save)(
        enquiryId,
        viewingId,
        kind,
        command,
        signal,
      );
      try {
        receipt = validateViewingTerminationReceipt(value, enquiryId, viewingId, kind, command);
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
    enquiryId,
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
