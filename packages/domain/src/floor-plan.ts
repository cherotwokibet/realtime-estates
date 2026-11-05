import { parseListingReportJson } from './listing-reports.js';
import { listingVideoTarget } from './listing-video.js';
export interface FloorPlanAttachmentCommand {
  readonly policy: 'synthetic-floor-plan-attachment-command-v1';
  readonly operationId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly expectedVersion: string;
  readonly requestId: string | null;
}
export interface FloorPlanMetadata {
  readonly operationId: string;
  readonly requestId: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
}
export interface FloorPlanAttachmentRecord {
  readonly policy: 'synthetic-floor-plan-attachment-v1';
  readonly command: FloorPlanAttachmentCommand;
  readonly actorId: string;
  readonly resultVersion: string;
  readonly floorPlan: FloorPlanMetadata | null;
}
export interface FloorPlanState {
  readonly policy: 'synthetic-floor-plan-state-v1';
  readonly listingId: string;
  readonly revision: number;
  readonly version: string;
  readonly state: 'draft' | 'pending' | 'approved' | 'rejected';
  readonly floorPlan: FloorPlanMetadata | null;
}
function fail(): never {
  throw Error('Invalid floor-plan facts.');
}
function exact(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).length !== keys.length
  )
    fail();
  const r: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail();
    r[k] = d.value;
  }
  return r;
}
function version(v: unknown): string {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,15}$/.test(v) || BigInt(v) > 9007199254740991n)
    fail();
  return v;
}
export function parseFloorPlanJson(text: string): unknown {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 2048) fail();
  return parseListingReportJson(text);
}
export function validateFloorPlanAttachmentCommand(v: unknown): FloorPlanAttachmentCommand {
  const r = exact(v, [
    'policy',
    'operationId',
    'listingId',
    'revision',
    'expectedVersion',
    'requestId',
  ]);
  if (r.policy !== 'synthetic-floor-plan-attachment-command-v1') fail();
  listingVideoTarget(r.operationId, 1);
  const target = listingVideoTarget(r.listingId, r.revision),
    expectedVersion = version(r.expectedVersion);
  if (expectedVersion === '9007199254740991') fail();
  if (r.requestId !== null) listingVideoTarget(r.requestId, 1);
  return Object.freeze({
    policy: r.policy,
    ...target,
    operationId: r.operationId as string,
    expectedVersion,
    requestId: r.requestId as string | null,
  });
}
export function validateFloorPlanMetadata(v: unknown): FloorPlanMetadata {
  const r = exact(v, ['operationId', 'requestId', 'width', 'height', 'bytes', 'sha256']);
  listingVideoTarget(r.operationId, 1);
  listingVideoTarget(r.requestId, 1);
  for (const k of ['width', 'height', 'bytes'])
    if (
      typeof r[k] !== 'number' ||
      !Number.isSafeInteger(r[k]) ||
      (r[k] as number) < 1 ||
      (r[k] as number) > (k === 'bytes' ? 10485760 : 1920)
    )
      fail();
  if (typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)) fail();
  return Object.freeze(r) as unknown as FloorPlanMetadata;
}
export function validateFloorPlanAttachmentRecord(
  v: unknown,
  original?: FloorPlanAttachmentCommand,
): FloorPlanAttachmentRecord {
  const r = exact(v, ['policy', 'command', 'actorId', 'resultVersion', 'floorPlan']),
    command = validateFloorPlanAttachmentCommand(r.command),
    resultVersion = version(r.resultVersion);
  listingVideoTarget(r.actorId, 1);
  const floorPlan = r.floorPlan === null ? null : validateFloorPlanMetadata(r.floorPlan);
  if (
    r.policy !== 'synthetic-floor-plan-attachment-v1' ||
    BigInt(resultVersion) !== BigInt(command.expectedVersion) + 1n ||
    (original &&
      JSON.stringify(command) !== JSON.stringify(validateFloorPlanAttachmentCommand(original))) ||
    (command.requestId === null
      ? floorPlan !== null
      : !floorPlan ||
        floorPlan.requestId !== command.requestId ||
        floorPlan.operationId !== command.operationId)
  )
    fail();
  return Object.freeze({
    policy: r.policy,
    command,
    actorId: r.actorId as string,
    resultVersion,
    floorPlan,
  });
}
export function validateFloorPlanState(
  v: unknown,
  listingId: string,
  revision: number,
): FloorPlanState {
  const r = exact(v, ['policy', 'listingId', 'revision', 'version', 'state', 'floorPlan']);
  listingVideoTarget(r.listingId, r.revision);
  if (
    r.policy !== 'synthetic-floor-plan-state-v1' ||
    r.listingId !== listingId ||
    r.revision !== revision ||
    !['draft', 'pending', 'approved', 'rejected'].includes(r.state as string)
  )
    fail();
  return Object.freeze({
    policy: r.policy,
    listingId,
    revision,
    version: version(r.version),
    state: r.state as FloorPlanState['state'],
    floorPlan: r.floorPlan === null ? null : validateFloorPlanMetadata(r.floorPlan),
  });
}
export interface FloorPlanPreparationCommand {
  readonly policy: 'synthetic-floor-plan-preparation-command-v1';
  readonly listingId: string;
  readonly revision: number;
  readonly expectedVersion: string;
  readonly requestId: string;
}
export interface PreparedFloorPlan extends Omit<FloorPlanPreparationCommand, 'policy'> {
  readonly policy: 'synthetic-floor-plan-prepared-v1';
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
}
export function validateFloorPlanPreparationCommand(v: unknown): FloorPlanPreparationCommand {
  const r = exact(v, ['policy', 'listingId', 'revision', 'expectedVersion', 'requestId']);
  if (r.policy !== 'synthetic-floor-plan-preparation-command-v1') fail();
  const command = validateFloorPlanAttachmentCommand({
    policy: 'synthetic-floor-plan-attachment-command-v1',
    operationId: r.requestId,
    listingId: r.listingId,
    revision: r.revision,
    expectedVersion: r.expectedVersion,
    requestId: r.requestId,
  });
  return Object.freeze({
    policy: r.policy,
    listingId: command.listingId,
    revision: command.revision,
    expectedVersion: command.expectedVersion,
    requestId: command.requestId!,
  });
}
export function validatePreparedFloorPlan(
  v: unknown,
  original: FloorPlanPreparationCommand,
): PreparedFloorPlan {
  const r = exact(v, [
      'policy',
      'listingId',
      'revision',
      'expectedVersion',
      'requestId',
      'width',
      'height',
      'bytes',
      'sha256',
    ]),
    t = validateFloorPlanPreparationCommand(original);
  if (
    r.policy !== 'synthetic-floor-plan-prepared-v1' ||
    r.listingId !== t.listingId ||
    r.revision !== t.revision ||
    r.expectedVersion !== t.expectedVersion ||
    r.requestId !== t.requestId
  )
    fail();
  const m = validateFloorPlanMetadata({
    operationId: t.requestId,
    requestId: t.requestId,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    sha256: r.sha256,
  });
  return Object.freeze({
    policy: r.policy,
    ...{
      listingId: t.listingId,
      revision: t.revision,
      expectedVersion: t.expectedVersion,
      requestId: t.requestId,
    },
    width: m.width,
    height: m.height,
    bytes: m.bytes,
    sha256: m.sha256,
  }) as unknown as PreparedFloorPlan;
}

/** Public facts intentionally exclude private operation/request and storage identifiers. */
export interface PublishedFloorPlan {
  readonly policy: 'synthetic-published-floor-plan-v1';
  readonly listingId: string;
  readonly revision: number;
  readonly approvedVersion: string;
  readonly floorPlan: Readonly<
    Pick<FloorPlanMetadata, 'width' | 'height' | 'bytes' | 'sha256'>
  > | null;
}
export function validatePublishedFloorPlan(
  v: unknown,
  listingId: string,
  revision: number,
): PublishedFloorPlan {
  const r = exact(v, ['policy', 'listingId', 'revision', 'approvedVersion', 'floorPlan']);
  listingVideoTarget(r.listingId, r.revision);
  if (
    r.policy !== 'synthetic-published-floor-plan-v1' ||
    r.listingId !== listingId ||
    r.revision !== revision
  )
    fail();
  let floorPlan: PublishedFloorPlan['floorPlan'] = null;
  if (r.floorPlan !== null) {
    const m = exact(r.floorPlan, ['width', 'height', 'bytes', 'sha256']);
    // Reuse the private image bounds without accepting any private fields.
    const checked = validateFloorPlanMetadata({
      ...m,
      operationId: listingId,
      requestId: listingId,
    });
    floorPlan = Object.freeze({
      width: checked.width,
      height: checked.height,
      bytes: checked.bytes,
      sha256: checked.sha256,
    });
  }
  return Object.freeze({
    policy: r.policy,
    listingId,
    revision,
    approvedVersion: version(r.approvedVersion),
    floorPlan,
  });
}
export function validateReviewFloorPlan(
  v: unknown,
  listingId: string,
  revision: number,
  expectedVersion: string,
): FloorPlanState {
  const result = validateFloorPlanState(v, listingId, revision);
  if (
    result.version !== version(expectedVersion) ||
    !['pending', 'approved'].includes(result.state)
  )
    fail();
  return result;
}
