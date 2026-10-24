export interface AllocationIdentity {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly actorId: string;
}
/** Comparison projection only; authority always comes from verified server context. */
export function captureAllocationIdentity(input: AllocationIdentity): AllocationIdentity {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw Error('Invalid allocation scope.');
  const fields = ['instanceId', 'tenantId', 'actorId'];
  if (
    Reflect.ownKeys(input).length !== 3 ||
    Reflect.ownKeys(input).some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    throw Error('Invalid allocation scope.');
  const value: Record<string, string> = {};
  for (const k of fields) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (
      !d?.enumerable ||
      !Object.hasOwn(d, 'value') ||
      typeof d.value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(d.value)
    )
      throw Error('Invalid allocation scope.');
    value[k] = d.value;
  }
  return Object.freeze(value) as unknown as AllocationIdentity;
}
