import { parseListingSuccessorJsonV2 } from '@realtor/domain';
import { parseCreationJson } from './listing-creation-wire.ts';
/** Shared duplicate-key/money guard followed by successor-specific exact revision tokens. */
export function parseSuccessorJson(source: string): unknown {
  parseCreationJson(source);
  return parseListingSuccessorJsonV2(source);
}
