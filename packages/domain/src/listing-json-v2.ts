import { DomainError } from "./errors.js";

function invalid(message: string): never {
  throw new DomainError("INVALID_LISTING_JSON_V2", message);
}

/**
 * Parse bounded v2 JSON without allowing decimal/exponent money tokens to round into integers.
 * Callers retain their input-size limits and must validate the resulting wire shape and values.
 * No JSON.parse reviver-context support or browser/native transport behavior is assumed.
 */
export function parseListingJsonV2(source: string): unknown {
  if (typeof source !== "string") return invalid("Listing JSON must be supplied as text.");
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { return invalid("Listing JSON contains invalid syntax."); }

  // Syntax has already been checked by JSON.parse. Consume whole strings so embedded JSON-looking
  // text cannot be mistaken for keys; decode strings to also recognize escaped amountMinor keys.
  const tokenPattern = /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/y;
  const integerLiteral = /^-?(?:0|[1-9]\d*)$/;
  let offset = 0;
  let previousString: string | undefined;
  let amountValuePending = false;
  while (offset < source.length) {
    if (/[ \t\r\n]/.test(source[offset]!)) { offset += 1; continue; }
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(source);
    if (!match) return invalid("Listing JSON contains an unsupported token.");
    const token = match[0];
    if (amountValuePending) {
      if ((token[0] === "-" || /^[0-9]/.test(token)) && !integerLiteral.test(token)) {
        return invalid("amountMinor requires an integer JSON number literal without fractions or exponents.");
      }
      amountValuePending = false;
    }
    if (token === ":" && previousString === "amountMinor") amountValuePending = true;
    previousString = token[0] === '"' ? JSON.parse(token) as string : undefined;
    offset = tokenPattern.lastIndex;
  }
  return parsed;
}
