import {
  validateContactCommand,
  validateContactReceipt,
  type ContactCommand,
  type ContactReceipt,
} from '@realtor/api-client';
import { EnquiryPreviewError, type EnquiryPreviewClient } from './enquiry-client.ts';
export interface ContactAttempt {
  readonly enquiryId: string;
  readonly command: ContactCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: ContactReceipt | null;
  submit(signal?: AbortSignal): Promise<ContactReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<ContactReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<ContactReceipt>;
}
/** Memory-only original attempt. No storage, retry timer, current-version adoption or outbound contact. */
export function prepareContactAttempt(
  client: Pick<EnquiryPreviewClient, 'recordContact' | 'recoverContact'>,
  id: string,
  input: ContactCommand,
): ContactAttempt {
  let command: ContactCommand;
  try {
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    )
      throw new Error();
    command = validateContactCommand(input);
  } catch {
    throw new EnquiryPreviewError('validation');
  }
  const enquiryId = id.toLowerCase(),
    record = client.recordContact.bind(client),
    recover = client.recoverContact.bind(client);
  let status: ContactAttempt['status'] = 'ready',
    receipt: ContactReceipt | null = null;
  async function run(
    mode: 'submit' | 'recover' | 'replay',
    signal?: AbortSignal,
  ): Promise<ContactReceipt> {
    if (
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      status !== (mode === 'submit' ? 'ready' : 'uncertain')
    )
      throw new EnquiryPreviewError('validation');
    const wasUncertain = status === 'uncertain';
    status = 'sending';
    try {
      const result = await (mode === 'recover' ? recover : record)(enquiryId, command, signal);
      try {
        receipt = validateContactReceipt(result, enquiryId, command.operationId, command);
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
    command,
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
