import { createHash, sign, verify } from 'node:crypto';

const policy = 'synthetic-deletion-intake-recovery-v1';
const fields = [
  'tenantId',
  'customerId',
  'requestId',
  'snapshotSha256',
  'snapshotCutoff',
  'recoveryCutoff',
  'requestedAt',
  'priorVersion',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const bad = () => {
  throw Error('Synthetic recovery export is invalid.');
};

function canonicalTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value))
    return false;
  const milliseconds = value.slice(0, 23) + 'Z';
  const time = new Date(milliseconds);
  return Number.isFinite(time.getTime()) && time.toISOString() === milliseconds;
}

function encode(facts) {
  if (!facts || Object.keys(facts).length !== fields.length) bad();
  for (const field of fields) if (!Object.hasOwn(facts, field)) bad();
  const {
    tenantId,
    customerId,
    requestId,
    snapshotSha256,
    snapshotCutoff,
    recoveryCutoff,
    requestedAt,
    priorVersion,
  } = facts;
  if (
    ![tenantId, customerId, requestId].every((id) => typeof id === 'string' && uuid.test(id)) ||
    typeof snapshotSha256 !== 'string' ||
    !digest.test(snapshotSha256) ||
    ![snapshotCutoff, recoveryCutoff, requestedAt].every(canonicalTime) ||
    !(snapshotCutoff < requestedAt && requestedAt <= recoveryCutoff) ||
    !Number.isSafeInteger(priorVersion) ||
    priorVersion < 1 ||
    priorVersion >= Number.MAX_SAFE_INTEGER
  )
    bad();
  return Buffer.from(
    JSON.stringify({ policy, ...Object.fromEntries(fields.map((field) => [field, facts[field]])) }),
  );
}

export async function syntheticSnapshotHash(snapshot) {
  return createHash('sha256')
    .update(Buffer.from(await snapshot.arrayBuffer()))
    .digest('hex');
}

export function signSyntheticIntakeExport(facts, privateKey) {
  const body = encode(facts);
  return { body, signature: sign(null, body, privateKey) };
}

export function verifySyntheticIntakeExport(bundle, publicKey, expected) {
  const { body, signature } = bundle;
  if (
    !Buffer.isBuffer(body) ||
    body.length > 1024 ||
    !Buffer.isBuffer(signature) ||
    signature.length !== 64 ||
    publicKey.asymmetricKeyType !== 'ed25519' ||
    !verify(null, body, publicKey, signature)
  )
    bad();
  const { policy: marker, ...facts } = JSON.parse(body.toString('utf8'));
  if (
    marker !== policy ||
    !encode(facts).equals(body) ||
    facts.tenantId !== expected.tenantId ||
    facts.customerId !== expected.customerId ||
    facts.requestId !== expected.requestId ||
    facts.snapshotSha256 !== expected.snapshotSha256 ||
    facts.snapshotCutoff !== expected.snapshotCutoff ||
    facts.recoveryCutoff !== expected.recoveryCutoff
  )
    bad();
  return Object.freeze(facts);
}
