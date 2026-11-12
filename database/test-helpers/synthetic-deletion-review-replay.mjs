import { isDeepStrictEqual } from 'node:util';

const reviewSteps = [
  ['customer_deletion_reviews', 'customer.deletion_triaged', 'reviewed_at'],
  ['customer_deletion_review_returns', 'customer.deletion_returned_to_review', 'returned_at'],
  ['synthetic_deletion_privacy_decisions', 'customer.deletion_privacy_decided', 'decided_at'],
];

const utcFormat = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

async function reviewRow(db, table, timestamp, tenantId, customerId) {
  const { rows } = await db.query(
    'SELECT to_jsonb(t) || jsonb_build_object($3::text,to_char(' +
      timestamp +
      " AT TIME ZONE 'UTC',$4)) AS row FROM app_private." +
      table +
      ' t WHERE tenant_id=$1 AND customer_id=$2',
    [tenantId, customerId, timestamp, utcFormat],
  );
  return rows[0]?.row;
}

async function auditRows(db, tenantId, operationId, action) {
  const { rows } = await db.query(
    "SELECT (to_jsonb(a)-'id') || jsonb_build_object('occurred_at',to_char(occurred_at AT TIME ZONE 'UTC',$4)) AS row FROM app_private.audit_events a WHERE tenant_id=$1 AND object_id=$2 AND action=$3",
    [tenantId, operationId, action, utcFormat],
  );
  return rows.map(({ row }) => row);
}

// Both connections belong to the disposable fixture. The source is quiescent during export.
export async function captureSyntheticDeletionReview(db, tenantId, customerId, requestId) {
  const records = [];
  for (const [table, action, timestamp] of reviewSteps) {
    const row = await reviewRow(db, table, timestamp, tenantId, customerId);
    if (!row) {
      records.push(null);
      continue;
    }
    const audit = await auditRows(db, tenantId, row.operation_id, action);
    if (row.request_id !== requestId || audit.length !== 1 || audit[0].actor_id !== row.reviewer_id)
      throw Error('Synthetic review and audit do not match.');
    records.push({ row, audit: audit[0] });
  }
  return { tenantId, customerId, requestId, records };
}

export async function replaySyntheticDeletionReview(tx, bundle) {
  const { tenantId, customerId, requestId, records } = bundle;
  const intake = await tx.query(
    'SELECT request_id FROM app_private.customer_deletion_requests WHERE tenant_id=$1 AND customer_id=$2 FOR UPDATE',
    [tenantId, customerId],
  );
  if (intake.rows[0]?.request_id !== requestId)
    throw Error('Recover the exact intake before review records.');
  for (const [index, [table, action, timestamp]] of reviewSteps.entries()) {
    const prior = await reviewRow(tx, table, timestamp, tenantId, customerId);
    const record = records[index];
    if (!record) {
      if (prior) throw Error('Restored review diverges from the authoritative fixture.');
      continue;
    }
    const { row, audit } = record;
    if (
      row.tenant_id !== tenantId ||
      row.customer_id !== customerId ||
      row.request_id !== requestId ||
      audit.tenant_id !== tenantId ||
      audit.object_id !== row.operation_id ||
      audit.actor_id !== row.reviewer_id ||
      audit.action !== action
    )
      throw Error('Recovery record escaped the request scope.');
    const existingAudit = await auditRows(tx, tenantId, row.operation_id, action);
    if (prior || existingAudit.length) {
      if (!isDeepStrictEqual(prior, row) || !isDeepStrictEqual(existingAudit, [audit]))
        throw Error('Restored review diverges from the authoritative fixture.');
      continue;
    }

    await tx.query(
      'INSERT INTO app_private.' +
        table +
        ' SELECT r.* FROM jsonb_populate_record(NULL::app_private.' +
        table +
        ', $1::jsonb) r',
      [JSON.stringify(row)],
    );
    await tx.query(
      'INSERT INTO app_private.audit_events(tenant_id,actor_id,action,object_type,object_id,object_version,correlation_id,summary,occurred_at) ' +
        'SELECT tenant_id,actor_id,action,object_type,object_id,object_version,correlation_id,summary,occurred_at ' +
        'FROM jsonb_populate_record(NULL::app_private.audit_events, $1::jsonb)',
      [JSON.stringify(audit)],
    );
  }
}
