import {
  validateListingVerificationCommand,
  validateListingVerificationReceipt,
  type ListingVerificationCommand,
  type ListingVerificationReceipt,
} from '@realtor/domain';
import {
  ListingVerificationError,
  type ListingVerificationClient,
} from './listing-verification-client.ts';
export interface ListingVerificationAttempt {
  readonly original: ListingVerificationCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: ListingVerificationReceipt | null;
  readonly canDiscard: boolean;
  submit(signal?: AbortSignal): Promise<ListingVerificationReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<ListingVerificationReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<ListingVerificationReceipt>;
}
/** Restored originals are uncertain until a current authorized read confirms their result. */
export function prepareListingVerificationAttempt(
  client: ListingVerificationClient,
  input: ListingVerificationCommand,
  restored = false,
): ListingVerificationAttempt {
  let original: ListingVerificationCommand;
  try {
    original = validateListingVerificationCommand(input);
    if (typeof restored !== 'boolean') throw Error();
  } catch {
    throw new ListingVerificationError('validation');
  }
  const create = client.create.bind(client),
    recover = client.recover.bind(client);
  let status: ListingVerificationAttempt['status'] = restored ? 'uncertain' : 'ready',
    receipt: ListingVerificationReceipt | null = null;
  async function run(mode: 'submit' | 'recover' | 'replay', signal?: AbortSignal) {
    if (
      status !== (mode === 'submit' ? 'ready' : 'uncertain') ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      throw new ListingVerificationError('validation');
    const uncertain = status === 'uncertain';
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : create)(original, signal);
      try {
        receipt = validateListingVerificationReceipt(value, original);
      } catch {
        throw new ListingVerificationError('response', 200, mode !== 'recover');
      }
      status = 'received';
      return receipt;
    } catch (error) {
      status =
        uncertain || !(error instanceof ListingVerificationError) || error.uncertain
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
