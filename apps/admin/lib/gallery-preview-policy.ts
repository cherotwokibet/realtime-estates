import type { MediaRemovalInputV2, MediaReorderInputV2 } from '@realtor/api-client';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Browser envelopes keep exact tokens as strings. Reject duplicate decoded keys before forwarding. */
export function galleryCommandBody(
  source: string,
  kind: 'remove' | 'reorder',
): MediaRemovalInputV2 | MediaReorderInputV2 {
  const parsed: unknown = JSON.parse(source);
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  const containers: (Set<string> | null)[] = [];
  for (let n = 0; n < tokens.length; n++) {
    const token = tokens[n]!;
    if (token === '{') containers.push(new Set());
    else if (token === '[') containers.push(null);
    else if (token === '}' || token === ']') containers.pop();
    else if (token.startsWith('"') && tokens[n + 1] === ':') {
      const keys = containers.at(-1),
        key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error('Duplicate key.');
      keys.add(key);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid envelope.');
  const value = parsed as Record<string, unknown>,
    allowed = ['operationId', 'expectedVersion', kind === 'remove' ? 'mediaId' : 'orderedIds'];
  if (Object.keys(value).length !== 3 || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Invalid envelope.');
  if (
    typeof value.operationId !== 'string' ||
    !uuid.test(value.operationId) ||
    typeof value.expectedVersion !== 'string' ||
    !/^[1-9]\d*$/.test(value.expectedVersion) ||
    BigInt(value.expectedVersion) > 9007199254740990n
  )
    throw new Error('Invalid identity or version.');
  const base = {
    operationId: value.operationId.toLowerCase(),
    expectedVersion: value.expectedVersion,
  };
  if (kind === 'remove') {
    if (typeof value.mediaId !== 'string' || !uuid.test(value.mediaId))
      throw new Error('Invalid photo.');
    return Object.freeze({ ...base, mediaId: value.mediaId.toLowerCase() });
  }
  if (
    !Array.isArray(value.orderedIds) ||
    value.orderedIds.length > 12 ||
    value.orderedIds.some((id) => typeof id !== 'string' || !uuid.test(id))
  )
    throw new Error('Invalid gallery.');
  const orderedIds = value.orderedIds.map((id: string) => id.toLowerCase());
  if (new Set(orderedIds).size !== orderedIds.length) throw new Error('Duplicate photo.');
  return Object.freeze({ ...base, orderedIds: Object.freeze(orderedIds) });
}
