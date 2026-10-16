export interface ViewingPropertyChoice {
  readonly id: string;
  readonly title: string;
  readonly locality: string;
  readonly purpose: 'rent' | 'sale';
}
export interface ViewingPropertyPage {
  readonly items: readonly ViewingPropertyChoice[];
  readonly limit: number;
  readonly mayBeTruncated: boolean;
}
const fail = (): never => {
  throw new Error('Invalid viewing property choices.');
};
function own(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail();
  if (Reflect.ownKeys(input).length !== fields.length) return fail();
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(input, field);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    result[field] = d.value;
  }
  return result;
}
function display(input: unknown, max: number): string {
  if (
    typeof input !== 'string' ||
    !input.trim() ||
    [...input].length > max ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(input)
  )
    return fail();
  return input;
}
/** Public labels only. Never grants eligibility; SQL rechecks the selected ID at save. */
export function validateViewingProperties(input: unknown, limit = 25): ViewingPropertyPage {
  const value = own(input, ['items', 'limit', 'mayBeTruncated']);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 25 ||
    value.limit !== limit ||
    !Array.isArray(value.items) ||
    Object.getPrototypeOf(value.items) !== Array.prototype ||
    value.items.length > limit ||
    Reflect.ownKeys(value.items).length !== value.items.length + 1 ||
    value.mayBeTruncated !== (value.items.length === limit)
  )
    return fail();
  const seen = new Set<string>(),
    items: ViewingPropertyChoice[] = [];
  for (let index = 0; index < value.items.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.items, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
    const item = own(descriptor.value, ['id', 'title', 'locality', 'purpose']);
    if (
      typeof item.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.id) ||
      seen.has(item.id) ||
      !['rent', 'sale'].includes(item.purpose as string)
    )
      return fail();
    seen.add(item.id);
    items.push(
      Object.freeze({
        id: item.id,
        title: display(item.title, 200),
        locality: display(item.locality, 300),
        purpose: item.purpose as 'rent' | 'sale',
      }),
    );
  }
  return Object.freeze({
    items: Object.freeze(items),
    limit,
    mayBeTruncated: value.mayBeTruncated as boolean,
  });
}
