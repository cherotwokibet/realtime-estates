import {
  validateViewingOriginal,
  validateViewingReceipt,
  type ViewingOriginal,
  type ViewingReceipt,
} from '@realtor/api-client';
import { EnquiryPreviewError, type EnquiryPreviewClient } from './enquiry-client.ts';
export interface ViewingAttempt {
  readonly enquiryId: string;
  readonly original: ViewingOriginal;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: ViewingReceipt | null;
  submit(signal?: AbortSignal): Promise<ViewingReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<ViewingReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<ViewingReceipt>;
}
/** Memory-only original request or proposal,never a refreshed command or automatic retry. */
export function prepareViewingAttempt(
  client: Pick<EnquiryPreviewClient, 'saveViewing' | 'recoverViewing'>,
  id: string,
  input: ViewingOriginal,
): ViewingAttempt {
  let original: ViewingOriginal;
  try {
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    )
      throw new Error();
    original = validateViewingOriginal(input);
  } catch {
    throw new EnquiryPreviewError('validation');
  }
  const enquiryId = id.toLowerCase(),
    save = client.saveViewing.bind(client),
    recover = client.recoverViewing.bind(client);
  let status: ViewingAttempt['status'] = 'ready',
    receipt: ViewingReceipt | null = null;
  async function run(
    mode: 'submit' | 'recover' | 'replay',
    signal?: AbortSignal,
  ): Promise<ViewingReceipt> {
    if (
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      status !== (mode === 'submit' ? 'ready' : 'uncertain')
    )
      throw new EnquiryPreviewError('validation');
    const wasUncertain = status === 'uncertain';
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : save)(enquiryId, original, signal);
      try {
        receipt = validateViewingReceipt(value, enquiryId, original);
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
