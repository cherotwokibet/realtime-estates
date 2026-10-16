import {
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  type ListingSuccessorCommand,
  type ListingSuccessorReceipt,
} from '@realtor/api-client';
import { ListingSuccessorError, type ListingSuccessorClient } from './listing-successor-client.ts';
export interface ListingSuccessorAttempt {
  readonly original: ListingSuccessorCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: ListingSuccessorReceipt | null;
  readonly canDiscard: boolean;
  submit(signal?: AbortSignal): Promise<ListingSuccessorReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<ListingSuccessorReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<ListingSuccessorReceipt>;
}
/** In-memory original cannot be replaced by an uncertain response or subsequent form edits. */
export function prepareListingSuccessorAttempt(
  client: ListingSuccessorClient,
  input: ListingSuccessorCommand,
): ListingSuccessorAttempt {
  let original: ListingSuccessorCommand;
  try {
    original = validateListingSuccessorCommand(input);
  } catch {
    throw new ListingSuccessorError('validation');
  }
  const create = client.create.bind(client),
    recover = client.recover.bind(client);
  let status: ListingSuccessorAttempt['status'] = 'ready',
    receipt: ListingSuccessorReceipt | null = null;
  async function run(mode: 'submit' | 'recover' | 'replay', signal?: AbortSignal) {
    if (
      status !== (mode === 'submit' ? 'ready' : 'uncertain') ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      throw new ListingSuccessorError('validation');
    const uncertain = status === 'uncertain';
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : create)(original, signal);
      try {
        receipt = validateListingSuccessorReceipt(value, original);
      } catch {
        throw new ListingSuccessorError('response', 200, mode !== 'recover');
      }
      status = 'received';
      return receipt;
    } catch (error) {
      status =
        uncertain || !(error instanceof ListingSuccessorError) || error.uncertain
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
    get canDiscard() {
      return status !== 'sending' && status !== 'uncertain';
    },
    submit: (signal?: AbortSignal) => run('submit', signal),
    recoverOriginal: (signal?: AbortSignal) => run('recover', signal),
    replayOriginal: (signal?: AbortSignal) => run('replay', signal),
  });
}
