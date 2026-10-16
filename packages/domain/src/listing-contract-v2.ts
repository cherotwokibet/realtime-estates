import { DomainError } from './errors.js';
import { kesFromMinor, type FeeTiming, type KesMoney, type RentalPeriod } from './money.js';
import {
  calculatePricingDisclosure,
  type ChargeClassification,
  type DisclosedCharge,
  type PricingDisclosure,
} from './pricing.js';

export type PricingDeclarationV2 = 'not_declared' | 'incomplete' | 'complete';
interface PricingChargeFieldsV2 {
  readonly id: string;
  readonly name: string;
  readonly timing: FeeTiming;
  readonly classification: ChargeClassification;
  readonly mandatory: boolean;
}
export type PricingChargeV2 = PricingChargeFieldsV2 &
  (
    | { readonly amountStatus: 'known'; readonly amountMinor: number }
    | { readonly amountStatus: 'quote_required'; readonly amountMinor: null }
  );
export interface PricingInputV2 {
  readonly declaration: PricingDeclarationV2;
  readonly charges: readonly PricingChargeV2[];
}
export interface PublicLocationV2 {
  readonly county: string | null;
  readonly town: string | null;
  readonly area: string | null;
}

function invalid(message: string): never {
  throw new DomainError('INVALID_LISTING_CONTRACT_V2', message);
}

/** Exact JSON data records only: no classes, inherited fields, symbols, getters or hidden fields. */
function exactRecord(
  input: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return invalid(`${label} must be a plain object.`);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    return invalid(`${label} must be a plain object.`);
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  ) {
    return invalid(`${label} must contain exactly its required fields.`);
  }
  for (const key in input) {
    if (!Object.hasOwn(input, key)) return invalid(`${label} cannot inherit data fields.`);
  }
  const record: Record<string, unknown> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      return invalid(`${label} requires enumerable own data fields.`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

/** Bounds count Unicode code points, matching PostgreSQL char_length rather than UTF-16 units. */
function wireText(input: unknown, maximum: number, label: string): string {
  if (
    typeof input !== 'string' ||
    input !== input.trim() ||
    input.length === 0 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input) ||
    /[\ud800-\udfff]/u.test(input) ||
    [...input].length > maximum
  ) {
    return invalid(
      `${label} must be trimmed, nonblank, control-free text of at most ${maximum} characters.`,
    );
  }
  return input;
}

function choice<T extends string>(input: unknown, allowed: readonly T[], label: string): T {
  if (typeof input !== 'string' || !allowed.includes(input as T))
    return invalid(`${label} is unsupported.`);
  return input as T;
}

function chargeInput(input: unknown, ids: Set<string>): PricingChargeV2 {
  const fields = exactRecord(
    input,
    ['id', 'name', 'amountStatus', 'amountMinor', 'timing', 'classification', 'mandatory'],
    'Charge',
  );
  const id = wireText(fields.id, 64, 'Charge ID');
  if (ids.has(id))
    return invalid('Charge IDs must be unique across mandatory and optional charges.');
  ids.add(id);
  const name = wireText(fields.name, 160, 'Charge name');
  const timing = choice(fields.timing, ['one_off', 'per_rental_period'] as const, 'Charge timing');
  const classification = choice(
    fields.classification,
    ['fee', 'refundable_deposit'] as const,
    'Charge classification',
  );
  if (typeof fields.mandatory !== 'boolean')
    return invalid('A charge must explicitly state whether it is mandatory.');
  const common: PricingChargeFieldsV2 = {
    id,
    name,
    timing,
    classification,
    mandatory: fields.mandatory,
  };
  if (
    fields.amountStatus === 'known' &&
    typeof fields.amountMinor === 'number' &&
    Number.isSafeInteger(fields.amountMinor) &&
    fields.amountMinor > 0
  ) {
    return Object.freeze({ ...common, amountStatus: 'known', amountMinor: fields.amountMinor });
  }
  if (fields.amountStatus === 'quote_required' && fields.amountMinor === null) {
    return Object.freeze({ ...common, amountStatus: 'quote_required', amountMinor: null });
  }
  return invalid(
    'A charge needs a positive safe-integer known amount or an explicit quote-required null amount.',
  );
}

export function validatePricingInputV2(input: unknown): PricingInputV2 {
  const fields = exactRecord(input, ['declaration', 'charges'], 'Pricing');
  const declaration = choice(
    fields.declaration,
    ['not_declared', 'incomplete', 'complete'] as const,
    'Pricing declaration',
  );
  const values = fields.charges;
  if (
    !Array.isArray(values) ||
    Object.getPrototypeOf(values) !== Array.prototype ||
    values.length > 32
  ) {
    return invalid('Pricing requires an array of at most 32 charges.');
  }
  const expectedKeys = new Set([
    'length',
    ...Array.from({ length: values.length }, (_, index) => String(index)),
  ]);
  const keys = Reflect.ownKeys(values);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
  ) {
    return invalid('Charges must be a dense array without additional fields.');
  }
  for (const key in values) {
    if (!Object.hasOwn(values, key)) return invalid('Charges cannot inherit data fields.');
  }
  const ids = new Set<string>();
  const charges = Array.from({ length: values.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return invalid('Each charge must be an own array value.');
    return chargeInput(descriptor.value, ids);
  });
  return Object.freeze({ declaration, charges: Object.freeze(charges) });
}

export function validatePublicLocationV2(input: unknown): PublicLocationV2 {
  const fields = exactRecord(input, ['county', 'town', 'area'], 'Public location');
  const nullableText = (value: unknown, label: string): string | null =>
    value === null ? null : wireText(value, 160, label);
  return Object.freeze({
    county: nullableText(fields.county, 'County'),
    town: nullableText(fields.town, 'Town'),
    area: nullableText(fields.area, 'Area'),
  });
}

/** Validate the exact wire shape, then delegate all money/period/charge arithmetic to the domain. */
export function calculateWirePricingV2(
  base: KesMoney,
  purpose: 'rent' | 'sale',
  rentalPeriod: RentalPeriod | null,
  wire: unknown,
): PricingDisclosure {
  const pricing = validatePricingInputV2(wire);
  const charges: readonly DisclosedCharge[] = pricing.charges.map((charge) => {
    const fields = {
      id: charge.id,
      name: charge.name,
      timing: charge.timing,
      classification: charge.classification,
      mandatory: charge.mandatory,
    };
    return charge.amountStatus === 'known'
      ? { ...fields, amountStatus: 'known', amount: kesFromMinor(charge.amountMinor) }
      : { ...fields, amountStatus: 'quote_required', amount: null };
  });
  return calculatePricingDisclosure({
    base,
    purpose,
    rentalPeriod,
    charges,
    ...(pricing.declaration === 'not_declared' ? {} : { disclosure: pricing.declaration }),
  });
}
