// Reuse strict duplicate-key and canonical JSON parsing for small control records.
export { parseCreationJson as parseControlJson } from './listing-creation-wire.ts';
