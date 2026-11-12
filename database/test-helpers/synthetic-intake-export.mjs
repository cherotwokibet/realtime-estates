import { createHash, sign, verify } from 'node:crypto';

const combinedPolicy = 'synthetic-deletion-recovery-v1';
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

function encode(facts, marker = policy) {
  const signedFields = marker === combinedPolicy ? [...fields, 'reviewSha256'] : fields;
  if (!facts || Object.keys(facts).length !== signedFields.length) bad();
  for (const field of signedFields) if (!Object.hasOwn(facts, field)) bad();
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
    (marker === combinedPolicy &&
      (typeof facts.reviewSha256 !== 'string' || !digest.test(facts.reviewSha256))) ||
    ![snapshotCutoff, recoveryCutoff, requestedAt].every(canonicalTime) ||
    !(snapshotCutoff < requestedAt && requestedAt <= recoveryCutoff) ||
    !Number.isSafeInteger(priorVersion) ||
    priorVersion < 1 ||
    priorVersion >= Number.MAX_SAFE_INTEGER
  )
    bad();
  return Buffer.from(
    JSON.stringify({
      policy: marker,
      ...Object.fromEntries(signedFields.map((field) => [field, facts[field]])),
    }),
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
  return verifyExport(bundle, publicKey, expected, policy);
}

function verifyExport(bundle, publicKey, expected, requiredPolicy) {
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
    marker !== requiredPolicy ||
    !encode(facts, requiredPolicy).equals(body) ||
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

function validateReview(review, intake) {
  if (
    review.tenantId !== intake.tenantId ||
    review.customerId !== intake.customerId ||
    review.requestId !== intake.requestId ||
    !Array.isArray(review.records) ||
    review.records.length !== 3 ||
    review.records.includes(undefined)
  )
    bad();
  const [triage, returned, decision] = review.records;
  if ((returned || decision) && !triage) bad();
  if (returned && triage.row.disposition !== 'needs_information') bad();
  if (decision && !returned && triage.row.disposition !== 'ready_for_privacy_review') bad();

  let prior = intake.requestedAt;
  const timestampFields = ['reviewed_at', 'returned_at', 'decided_at'];
  for (const [index, record] of review.records.entries()) {
    if (record === null) continue;
    const { row, audit } = record;
    const timestamp = row[timestampFields[index]];
    const auditTime = audit.occurred_at;
    if (
      !canonicalTime(timestamp) ||
      !canonicalTime(auditTime) ||
      timestamp < prior ||
      timestamp > intake.recoveryCutoff ||
      auditTime < intake.requestedAt ||
      auditTime > intake.recoveryCutoff
    )
      bad();
    prior = timestamp;
  }
}

export function signSyntheticDeletionExport(intake, review, privateKey) {
  validateReview(review, intake);
  const reviewBytes = Buffer.from(JSON.stringify(review));
  if (reviewBytes.length > 8192) bad();
  const body = encode(
    { ...intake, reviewSha256: createHash('sha256').update(reviewBytes).digest('hex') },
    combinedPolicy,
  );
  return { body, signature: sign(null, body, privateKey), reviewBytes };
}

export function verifySyntheticDeletionExport(bundle, publicKey, expected) {
  const { reviewSha256, ...intake } = verifyExport(bundle, publicKey, expected, combinedPolicy);
  const { reviewBytes } = bundle;
  if (
    !Buffer.isBuffer(reviewBytes) ||
    reviewBytes.length > 8192 ||
    createHash('sha256').update(reviewBytes).digest('hex') !== reviewSha256
  )
    bad();
  const review = JSON.parse(reviewBytes.toString('utf8'));
  validateReview(review, intake);
  return { intake, review };
}
