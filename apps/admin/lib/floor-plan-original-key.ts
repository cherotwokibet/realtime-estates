/** One listing slot spans revisions and actors so a foreign/malformed original keeps edits locked. */
export const floorPlanOriginalKey = (instanceId: string, listingId: string) =>
  `synthetic-floor-plan-original-v1:${instanceId}:${listingId}`;
export function assertFloorPlanClear(
  store: { getItem(key: string): string | null },
  instanceId: string,
  listingId: string,
) {
  if (store.getItem(floorPlanOriginalKey(instanceId, listingId)) !== null)
    throw Error('Finish the retained floor-plan original first.');
}
