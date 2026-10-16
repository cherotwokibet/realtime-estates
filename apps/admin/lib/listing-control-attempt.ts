import {
  validateListingControlCommand,
  validateListingControlReceipt,
  type ListingControlCommand,
  type ListingControlReceipt,
} from '@realtor/api-client';
import { ListingControlError, type ListingControlClient } from './listing-control-client.ts';
export interface ListingControlAttempt {
  readonly original: ListingControlCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: ListingControlReceipt | null;
  readonly canDiscard: boolean;
  submit(signal?: AbortSignal): Promise<ListingControlReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<ListingControlReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<ListingControlReceipt>;
}
/** In-memory original cannot be replaced by an uncertain response or subsequent form edits. */
export function prepareListingControlAttempt(
  client: ListingControlClient,
  input: ListingControlCommand,
): ListingControlAttempt {
  let original: ListingControlCommand;
  try {
    original = validateListingControlCommand(input);
  } catch {
    throw new ListingControlError('validation');
  }
  const create = client.create.bind(client),
    recover = client.recover.bind(client);
  let status: ListingControlAttempt['status'] = 'ready',
    receipt: ListingControlReceipt | null = null;
  async function run(mode: 'submit' | 'recover' | 'replay', signal?: AbortSignal) {
    if (
      status !== (mode === 'submit' ? 'ready' : 'uncertain') ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      throw new ListingControlError('validation');
    const uncertain = status === 'uncertain';
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : create)(original, signal);
      try {
        receipt = validateListingControlReceipt(value, original);
      } catch {
        throw new ListingControlError('response', 200, mode !== 'recover');
      }
      status = 'received';
      return receipt;
    } catch (error) {
      status =
        uncertain || !(error instanceof ListingControlError) || error.uncertain
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
