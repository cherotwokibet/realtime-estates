import { readBrowserDecodedJson } from './browser-decoded-json.ts';
import { parseVerificationJson } from './listing-verification-wire.ts';
import { readReferenceJson } from './reference-draft-wire.ts';
export function parseReferenceModerationJson(source: string): unknown {
  const result = parseVerificationJson(source);
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  for (let i = 0; i < tokens.length; i++)
    if (
      tokens[i]?.startsWith('"') &&
      tokens[i + 1] === ':' &&
      ['position', 'publishedRevision', 'bedrooms', 'privateBathrooms', 'sharedBathrooms'].includes(
        JSON.parse(tokens[i]!),
      ) &&
      !/^(?:null|0|[1-9]\d*)$/.test(tokens[i + 2] ?? '')
    )
      throw Error('Invalid reference integer token.');
  return result;
}
export const readReferenceModerationJson = (source: Request | Response, signal: AbortSignal) =>
  source instanceof Response
    ? readBrowserDecodedJson(source, 131072, signal, parseReferenceModerationJson)
    : readReferenceJson(source, 131072, signal, parseReferenceModerationJson);
