import {
  validateListingCreationCommand,
  validateListingCreationReceipt,
  type ListingCreationCommand,
  type ListingCreationReceipt,
} from '@realtor/api-client';
import { ListingCreationError, type ListingCreationClient } from './listing-creation-client.ts';
export interface ListingCreationAttempt {
  readonly original: ListingCreationCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: ListingCreationReceipt | null;
  readonly canDiscard: boolean;
  submit(signal?: AbortSignal): Promise<ListingCreationReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<ListingCreationReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<ListingCreationReceipt>;
}
/** In-memory original cannot be replaced by an uncertain response or subsequent form edits. */
export function prepareListingCreationAttempt(
  client: ListingCreationClient,
  input: ListingCreationCommand,
): ListingCreationAttempt {
  let original: ListingCreationCommand;
  try {
    original = validateListingCreationCommand(input);
  } catch {
    throw new ListingCreationError('validation');
  }
  const create = client.create.bind(client),
    recover = client.recover.bind(client);
  let status: ListingCreationAttempt['status'] = 'ready',
    receipt: ListingCreationReceipt | null = null;
  async function run(mode: 'submit' | 'recover' | 'replay', signal?: AbortSignal) {
    if (
      status !== (mode === 'submit' ? 'ready' : 'uncertain') ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      throw new ListingCreationError('validation');
    const uncertain = status === 'uncertain';
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : create)(original, signal);
      try {
        receipt = validateListingCreationReceipt(value, original);
      } catch {
        throw new ListingCreationError('response', 200, mode !== 'recover');
      }
      status = 'received';
      return receipt;
    } catch (error) {
      status =
        uncertain || !(error instanceof ListingCreationError) || error.uncertain
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
