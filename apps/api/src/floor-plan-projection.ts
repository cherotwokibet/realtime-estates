import {
  validateFloorPlanAttachmentCommand,
  validateFloorPlanAttachmentRecord,
  validateFloorPlanState,
  type FloorPlanAttachmentCommand,
} from '@realtor/domain';
function fail(): never {
  throw Error('Floor-plan SQL projection differs.');
}
function object(v: unknown, keys: readonly string[]): Record<string, unknown> {
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
export function floorPlanRecordFromSql(
  v: unknown,
  tenantId: string,
  original?: FloorPlanAttachmentCommand,
) {
  const r = object(v, ['policy', 'command', 'actorId', 'resultVersion', 'output']),
    command = validateFloorPlanAttachmentCommand(r.command);
  if (r.policy !== 'synthetic-floor-plan-attachment-record-v1') fail();
  let floorPlan = null;
  if (command.requestId !== null) {
    const o = object(r.output, ['policy', 'lease', 'manifest', 'manifestSha256', 'verifiedAt']),
      l = object(o.lease, [
        'policy',
        'registration',
        'claimId',
        'leaseNonce',
        'outputObjectId',
        'claimedAt',
        'expiresAt',
      ]),
      g = object(l.registration, [
        'policy',
        'role',
        'pipeline',
        'countsAsPhoto',
        'binding',
        'source',
        'registeredAt',
        'expiresAt',
      ]),
      b = object(g.binding, [
        'companyId',
        'actorId',
        'listingId',
        'revision',
        'expectedVersion',
        'requestId',
        'jobId',
        'generationId',
        'inputObjectId',
      ]),
      m = object(o.manifest, [
        'pipeline',
        'role',
        'countsAsPhoto',
        'sourceFormat',
        'inputSha256',
        'inputBytes',
        'format',
        'mimeType',
        'sha256',
        'width',
        'height',
        'bytes',
        'encoder',
        'operations',
      ]),
      source = object(g.source, ['sha256', 'bytes', 'format']);
    if (
      o.policy !== 'synthetic-floor-plan-output-v1' ||
      l.policy !== 'synthetic-floor-plan-lease-v1' ||
      g.policy !== 'synthetic-floor-plan-registration-v1' ||
      g.role !== 'floor_plan' ||
      g.countsAsPhoto !== false ||
      g.pipeline !== 'synthetic-floor-plan-codec-v1' ||
      b.companyId !== tenantId ||
      b.listingId !== command.listingId ||
      b.revision !== command.revision ||
      b.requestId !== command.requestId ||
      m.pipeline !== 'synthetic-floor-plan-codec-v1' ||
      m.role !== 'floor_plan' ||
      m.countsAsPhoto !== false ||
      m.format !== 'webp' ||
      m.mimeType !== 'image/webp' ||
      m.inputSha256 !== source.sha256 ||
      m.inputBytes !== source.bytes ||
      m.sourceFormat !== source.format ||
      JSON.stringify(m.operations) !==
        JSON.stringify([
          'auto-orient',
          'resize-inside-1920-without-enlargement',
          'strip-metadata',
          'webp-lossless-effort-4',
        ])
    )
      fail();
    floorPlan = {
      operationId: command.operationId,
      requestId: command.requestId,
      width: m.width,
      height: m.height,
      bytes: m.bytes,
      sha256: m.sha256,
    };
  } else if (r.output !== null) fail();
  return validateFloorPlanAttachmentRecord(
    {
      policy: 'synthetic-floor-plan-attachment-v1',
      command,
      actorId: r.actorId,
      resultVersion: r.resultVersion,
      floorPlan,
    },
    original,
  );
}
export function floorPlanStateFromSql(
  v: unknown,
  tenantId: string,
  actorId: string,
  listingId: string,
  revision: number,
) {
  const r = object(v, [
    'policy',
    'companyId',
    'actorId',
    'listingId',
    'revision',
    'version',
    'state',
    'floorPlan',
  ]);
  if (
    r.policy !== 'synthetic-floor-plan-gallery-v1' ||
    r.companyId !== tenantId ||
    r.actorId !== actorId ||
    r.listingId !== listingId ||
    r.revision !== revision
  )
    fail();
  const plan = r.floorPlan === null ? null : floorPlanRecordFromSql(r.floorPlan, tenantId);
  if (
    plan &&
    (plan.command.listingId !== listingId ||
      plan.command.revision !== revision ||
      BigInt(plan.resultVersion) > BigInt(r.version as string))
  )
    fail();
  return validateFloorPlanState(
    {
      policy: 'synthetic-floor-plan-state-v1',
      listingId,
      revision,
      version: r.version,
      state: r.state,
      floorPlan: plan?.floorPlan ?? null,
    },
    listingId,
    revision,
  );
}
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { isSharedArrayBuffer } from 'node:util/types';
import type { FloorPlanState } from '@realtor/domain';
export function floorPlanImageFromProvider(
  value: unknown,
  state: FloorPlanState,
  tenantId: string,
  actorId: string,
) {
  const r = object(value, ['state', 'target', 'version', 'operationId', 'manifest', 'data']),
    t = object(r.target, ['companyId', 'actorId', 'listingId', 'revision']),
    m = object(r.manifest, [
      'pipeline',
      'role',
      'countsAsPhoto',
      'sourceFormat',
      'inputSha256',
      'inputBytes',
      'format',
      'mimeType',
      'sha256',
      'width',
      'height',
      'bytes',
      'encoder',
      'operations',
    ]);
  const expected = state.floorPlan;
  if (
    !expected ||
    r.state !== 'ready' ||
    t.companyId !== tenantId ||
    t.actorId !== actorId ||
    t.listingId !== state.listingId ||
    t.revision !== state.revision ||
    r.version !== state.version ||
    r.operationId !== expected.operationId ||
    m.pipeline !== 'synthetic-floor-plan-codec-v1' ||
    m.role !== 'floor_plan' ||
    m.countsAsPhoto !== false ||
    m.format !== 'webp' ||
    m.mimeType !== 'image/webp' ||
    m.sha256 !== expected.sha256 ||
    m.bytes !== expected.bytes ||
    m.width !== expected.width ||
    m.height !== expected.height ||
    !Buffer.isBuffer(r.data) ||
    isSharedArrayBuffer(r.data.buffer) ||
    r.data.length !== expected.bytes
  )
    fail();
  const bytes = Buffer.from(r.data);
  if (
    createHash('sha256').update(bytes).digest('hex') !== expected.sha256 ||
    bytes.toString('latin1', 0, 4) !== 'RIFF' ||
    bytes.toString('latin1', 8, 12) !== 'WEBP'
  )
    fail();
  return bytes;
}
