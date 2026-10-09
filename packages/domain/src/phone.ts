import { DomainError } from "./errors.js";

/** This pilot supports Kenyan mobile-format 07/01 and their +254 forms; it does not verify allocation or ownership. */
export function normalizeKenyanPhone(input: string): string {
  if (typeof input !== "string" || !/^[+\d\s()\-]+$/.test(input)) {
    throw new DomainError("INVALID_PHONE", "Use a Kenyan 07/01 mobile number without an extension.");
  }
  const compact = input.replace(/[\s()\-]/g, "");
  if (/^0[17]\d{8}$/.test(compact)) return `+254${compact.slice(1)}`;
  if (/^\+?254[17]\d{8}$/.test(compact)) return compact.startsWith("+") ? compact : `+${compact}`;
  throw new DomainError("INVALID_PHONE", "Use 10-digit 07/01, or +254 followed by the 9-digit mobile number.");
}
