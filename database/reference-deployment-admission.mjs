// Trusted deployment control-plane only; never expose this as an HTTP/staff API.
// Supply an exclusively leased owner connection, outside any existing transaction.
const protocols = Object.freeze({
  editor: 'combined-reference-editor-v1',
  revisionReader: 'synthetic-reference-revision-v1',
  draftRecovery: 'synthetic-reference-draft-v1',
  transitionRecovery: 'synthetic-reference-transition-v1',
  creationRecovery: 'synthetic-reference-creation-v1',
  successorRecovery: 'synthetic-reference-successor-v1',
  publicReader: 'synthetic-reference-public-v1',
});
export const referenceDeploymentProtocols = protocols;
function capabilities(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype)
    throw Error('Invalid deployment capabilities.');
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== Object.keys(protocols).length ||
    keys.some((key) => typeof key !== 'string' || !Object.hasOwn(protocols, key))
  )
    throw Error('Invalid deployment capabilities.');
  const result = {};
  for (const [key, protocol] of Object.entries(protocols)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      ![null, protocol].includes(descriptor.value)
    )
      throw Error('Invalid deployment capabilities.');
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}
const tables = Object.freeze({
  catalogues: 'synthetic_reference_catalogues',
  drafts: 'synthetic_reference_draft_receipts',
  transitions: 'synthetic_reference_transitions',
  approved: 'synthetic_reference_approved',
  creations: 'synthetic_reference_creation_receipts',
  successors: 'synthetic_reference_successor_receipts',
});
const routines = Object.freeze({
  editor: [
    'save_synthetic_reference_draft(uuid,integer,bigint,uuid,jsonb,jsonb)',
    'read_synthetic_revision_protocol(uuid,integer)',
  ],
  revisionReader: ['read_synthetic_reference_revision(uuid,integer,bigint)'],
  draftRecovery: [
    'read_synthetic_reference_draft(uuid,uuid)',
    'read_synthetic_reference_draft_context(uuid,uuid)',
    'read_synthetic_reference_catalogue(bigint)',
  ],
  transitionRecovery: ['read_synthetic_reference_transition(uuid,uuid)'],
  creationRecovery: ['read_synthetic_reference_creation(uuid,uuid)'],
  successorRecovery: ['read_synthetic_reference_successor(uuid,uuid)'],
  publicReader: [],
});
/** Admit a non-destructive application/config switch while adopted rows/receipts are fenced.
 * activate must switch only the trusted application artifact; never execute destructive SQL.
 * The lease must remain exclusive until this promise settles. No receipt or customer facts return.
 * This does not replace artifact attestation, health checks, hosted locking proof or cutover approval.
 */
export async function withReferenceDeploymentAdmission(connection, input, activate) {
  const offered = capabilities(input); // Snapshot before the first await; reject getters/extra fields.
  if (typeof activate !== 'function') throw Error('A trusted activation callback is required.');
  // READ COMMITTED is deliberate: acquire the fence before taking the row snapshots.
  // A transaction that committed adoption while we waited must be visible afterwards.
  await connection.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  let committed = false;
  try {
    const authority = (
      await connection.query(
        "SELECT current_user='realtor_owner' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) AS owner",
      )
    ).rows[0];
    if (authority?.owner !== true) throw Error('Deployment admission requires owner authority.');
    await connection.query("SET LOCAL lock_timeout='2s'");
    // Blocks adoption/ALTER of revision storage until the activation callback has settled.
    await connection.query('LOCK TABLE app_private.listing_revisions IN SHARE MODE');
    const inventory = (
      await connection.query(
        "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app_private' AND table_name='listing_revisions' AND column_name='synthetic_reference_attributes') AS attributes",
      )
    ).rows[0];
    if (typeof inventory?.attributes !== 'boolean') throw Error('Reference inventory unavailable.');
    const flag = (row, key) => {
      if (typeof row?.[key] !== 'boolean') throw Error('Reference inventory unavailable.');
      return row[key];
    };
    const present = {};
    for (const [key, table] of Object.entries(tables))
      present[key] = flag(
        (
          await connection.query('SELECT to_regclass($1) IS NOT NULL AS present', [
            'app_private.' + table,
          ])
        ).rows[0],
        'present',
      );
    const any = Object.values(present).some(Boolean) || inventory?.attributes === true;
    if (any && (!inventory?.attributes || !present.catalogues || !present.drafts))
      throw Error('Partial reference schema refuses deployment admission.');
    const occupied = {};
    if (any) {
      for (const [key, table] of Object.entries(tables))
        if (present[key]) {
          // Identifiers come exclusively from the fixed internal table map, never from input.
          await connection.query('LOCK TABLE app_private.' + table + ' IN SHARE MODE');
          occupied[key] = flag(
            (
              await connection.query(
                'SELECT EXISTS(SELECT 1 FROM app_private.' + table + ') AS occupied',
              )
            ).rows[0],
            'occupied',
          );
        }
      occupied.revisions = flag(
        (
          await connection.query(
            'SELECT EXISTS(SELECT 1 FROM app_private.listing_revisions WHERE synthetic_reference_attributes IS NOT NULL) AS occupied',
          )
        ).rows[0],
        'occupied',
      );
    }
    const adopted = !!(
      occupied.revisions ||
      occupied.drafts ||
      occupied.transitions ||
      occupied.approved ||
      occupied.creations ||
      occupied.successors
    );
    const required = new Set(adopted ? ['editor', 'revisionReader', 'draftRecovery'] : []);
    if (occupied.transitions || occupied.approved) required.add('transitionRecovery');
    if (occupied.approved) required.add('publicReader');
    if (occupied.creations) required.add('creationRecovery');
    if (occupied.successors) required.add('successorRecovery');
    for (const name of required)
      if (offered[name] !== protocols[name])
        throw Error('Unsafe reference capability rollback refused: ' + name + '.');
    for (const name of required)
      for (const signature of routines[name]) {
        const row = (
          await connection.query(
            "SELECT CASE WHEN to_regprocedure($1) IS NULL THEN false ELSE has_function_privilege('api_runtime',to_regprocedure($1),'EXECUTE') END AS available",
            ['app_api.' + signature],
          )
        ).rows[0];
        if (flag(row, 'available') !== true)
          throw Error('Required reference routine unavailable: ' + name + '.');
      }
    const decision = Object.freeze({
      policy: 'preserve-reference-schema-v1',
      adopted,
      required: Object.freeze([...required].sort()),
    });
    // Keep every SHARE lock until the actual trusted activation completes or fails.
    await activate(decision);
    await connection.query('COMMIT');
    committed = true;
    return decision;
  } finally {
    if (!committed) await connection.query('ROLLBACK');
  }
}
