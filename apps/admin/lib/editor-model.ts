import {
  validateStaffDraftContentV2,
  type StaffDraftContentV2,
  type StaffDraftV2,
} from '@realtor/api-client';
export interface ChargeForm {
  id: string;
  name: string;
  amountStatus: 'known' | 'quote_required';
  amount: string;
  timing: 'one_off' | 'per_rental_period';
  classification: 'fee' | 'refundable_deposit';
  mandatory: boolean;
}
export interface DraftForm {
  title: string;
  description: string;
  purpose: string;
  propertyType: string;
  amount: string;
  rentPeriod: string;
  bedrooms: string;
  privateBathrooms: string;
  sharedBathrooms: string;
  locality: string;
  privateAddress: string;
  publicPrecision: string;
  latitude: string;
  longitude: string;
  county: string;
  town: string;
  area: string;
  declaration: 'not_declared' | 'incomplete' | 'complete';
  charges: ChargeForm[];
}
export function moneyText(minor: number | null): string {
  return minor === null ? '' : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
/** Never convert a decimal through floating point or accept exponential notation. */
export function parseMoney(text: string): number | null {
  const value = text.trim();
  if (value === '') return null;
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))
    throw new Error('Use a positive KES amount with at most two decimal places.');
  const [whole = '', fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('The amount is outside the supported range.');
  return Number(minor);
}
export function draftToForm(content: StaffDraftContentV2): DraftForm {
  const string = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  return {
    title: string(content.title),
    description: string(content.description),
    purpose: string(content.purpose),
    propertyType: string(content.propertyType),
    amount: moneyText(content.amountMinor),
    rentPeriod: string(content.rentPeriod),
    bedrooms: string(content.bedrooms),
    privateBathrooms: string(content.privateBathrooms),
    sharedBathrooms: string(content.sharedBathrooms),
    locality: string(content.locality),
    privateAddress: string(content.privateAddress),
    publicPrecision: content.publicPrecision,
    latitude: string(content.latitude),
    longitude: string(content.longitude),
    county: string(content.location.county),
    town: string(content.location.town),
    area: string(content.location.area),
    declaration: content.pricing.declaration,
    charges: content.pricing.charges.map((charge) => ({
      ...charge,
      amount: moneyText(charge.amountMinor),
    })),
  };
}
export function formToDraft(form: DraftForm): StaffDraftContentV2 {
  const optional = (value: string) => value.trim() || null;
  const count = (value: string) => {
    if (value === '') return null;
    if (!/^\d+$/.test(value)) throw new Error('Room counts must be whole numbers.');
    return Number(value);
  };
  const coordinate = (value: string) => {
    if (value.trim() === '') return null;
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))
      throw new Error('Coordinates must be finite numbers.');
    return Number(value);
  };
  return validateStaffDraftContentV2({
    title: optional(form.title),
    description: optional(form.description),
    purpose: optional(form.purpose),
    propertyType: optional(form.propertyType),
    currency: 'KES',
    amountMinor: parseMoney(form.amount),
    rentPeriod: optional(form.rentPeriod),
    bedrooms: count(form.bedrooms),
    privateBathrooms: count(form.privateBathrooms),
    sharedBathrooms: count(form.sharedBathrooms),
    country: 'KE',
    locality: optional(form.locality),
    privateAddress: form.privateAddress === '' ? null : form.privateAddress,
    publicPrecision: form.publicPrecision,
    latitude: coordinate(form.latitude),
    longitude: coordinate(form.longitude),
    location: {
      county: optional(form.county),
      town: optional(form.town),
      area: optional(form.area),
    },
    pricing: {
      declaration: form.declaration,
      charges: form.charges.map(({ amount, ...charge }) => ({
        ...charge,
        name: charge.name.trim(),
        amountMinor: charge.amountStatus === 'quote_required' ? null : parseMoney(amount),
      })),
    },
  });
}
export const formsEqual = (left: DraftForm, right: DraftForm) =>
  JSON.stringify(left) === JSON.stringify(right);
export const draftsEqual = (left: StaffDraftContentV2, right: StaffDraftContentV2) =>
  JSON.stringify(validateStaffDraftContentV2(left)) ===
  JSON.stringify(validateStaffDraftContentV2(right));
/** A readback can prove an uncertain write landed. Different data never silently replaces local edits. */
export function reconcileDraft(
  baseline: StaffDraftV2,
  local: DraftForm,
  remote: StaffDraftV2,
): 'unchanged' | 'saved' | 'conflict' {
  try {
    if (draftsEqual(formToDraft(local), remote.content)) return 'saved';
  } catch {
    /* Keep invalid local input for correction. */
  }
  return remote.version === baseline.version &&
    remote.state === baseline.state &&
    draftsEqual(remote.content, baseline.content)
    ? 'unchanged'
    : 'conflict';
}
