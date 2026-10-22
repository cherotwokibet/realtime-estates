import { parseListingSuccessorJsonV2 } from '@realtor/domain';
import { parseCreationJson } from './listing-creation-wire.ts';

/** Both decoded duplicate keys and integer revision spelling must survive validation. */
export function parseVerificationJson(source: string): unknown {
  parseCreationJson(source);
  return parseListingSuccessorJsonV2(source);
}
