import {
  validateListingVerificationCommand,
  type ListingVerificationCommand,
} from '@realtor/domain';
import { parseVerificationJson } from './listing-verification-wire.ts';
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function listingVerificationSession(store: Store, instanceId: string, listingId: string) {
  if (!uuid.test(instanceId) || !uuid.test(listingId))
    throw Error('Invalid retained assessment scope.');
  const key = `synthetic-check-original-v1:${instanceId}:${listingId}`;
  function validate(input: unknown) {
    const command = validateListingVerificationCommand(input);
    if (command.target.listingId !== listingId) throw Error('Retained assessment changed listing.');
    return command;
  }
  return Object.freeze({
    load(): ListingVerificationCommand | null {
      const raw = store.getItem(key);
      if (raw === null) return null;
      if (raw.length > 16384) throw Error('Invalid retained assessment.');
      return validate(parseVerificationJson(raw));
    },
    save(input: ListingVerificationCommand) {
      const command = validate(input),
        raw = JSON.stringify(command);
      store.setItem(key, raw);
      if (store.getItem(key) !== raw) throw Error('Assessment original could not be retained.');
      return command;
    },
    clear() {
      store.removeItem(key);
      if (store.getItem(key) !== null) throw Error('Assessment original could not be cleared.');
    },
  });
}
