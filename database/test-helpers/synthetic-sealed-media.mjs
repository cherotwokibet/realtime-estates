import { createHash, randomUUID } from 'node:crypto';

/**
 * Privileged, disposable SQL fixture ONLY. These fabricated historical records
 * satisfy relational provenance so unrelated auth/moderation tests can retain
 * their original revision tokens. No image bytes exist, no decoder/native child
 * runs, and this does not prove that the registration/attachment workflow ran.
 * Never call this from a production application, migration, or restricted login.
 */
export async function seedSyntheticSealedMedia(
  database,
  {
    tenantId,
    listingId,
    revision = 1,
    mediaId = randomUUID(),
    position,
    altText = 'Synthetic SQL-only photo fixture; image bytes unavailable',
    bytes = 100,
    width = 100,
    height = 100,
  },
) {
  const context = (
    await database.query(
      `SELECT l.assigned_agent_id AS requester,r.version::text AS version,r.state
    FROM app_private.listings l JOIN app_private.listing_revisions r
      ON r.tenant_id=l.tenant_id AND r.listing_id=l.id
    WHERE l.tenant_id=$1 AND l.id=$2 AND r.revision_no=$3`,
      [tenantId, listingId, revision],
    )
  ).rows[0];
  if (!context || context.state !== 'draft' || BigInt(context.version) < 2n)
    throw new Error(
      'Synthetic sealed SQL fixture requires an existing draft with version at least2.',
    );
  const expected = (BigInt(context.version) - 1n).toString();
  const jobId = randomUUID(),
    registrationId = randomUUID(),
    quarantineId = randomUUID(),
    outputId = randomUUID();
  const generationId = randomUUID(),
    claimId = randomUUID(),
    leaseNonce = randomUUID(),
    operationId = randomUUID();
  const inputSha256 = createHash('sha256')
    .update(`SQL-only synthetic input/${mediaId}`)
    .digest('hex');
  const sha256 = createHash('sha256').update(`SQL-only synthetic output/${mediaId}`).digest('hex');
  const manifest = {
    pipeline: 'synthetic-codec-v1',
    sourceFormat: 'png',
    inputSha256,
    inputBytes: 100,
    format: 'webp',
    mimeType: 'image/webp',
    sha256,
    width,
    height,
    bytes,
    encoder: { sharp: '0.35.5', vips: '8.18.7' },
    operations: [
      'auto-orient',
      'resize-inside-1920-without-enlargement',
      'strip-metadata',
      'webp-quality-82-effort-4',
    ],
  };
  const registered = (
    await database.query(
      `WITH facts AS (SELECT clock_timestamp() AS created),payload AS (
      SELECT created,jsonb_build_object('kind','register_media_upload','tenantId',$1::uuid,'actorId',$2::uuid,
        'listingId',$3::uuid,'revision',$4::integer,'expectedVersion',$5::text,'jobId',$7::uuid,'altText',$8::text) AS body FROM facts)
    INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
      expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    SELECT $1,$6,'register_media_upload',$3,$4,$2,$5::bigint,$7,body,encode(sha256(convert_to(body::text,'UTF8')),'hex'),
      jsonb_build_object('kind','register_media_upload','operationId',$6::uuid,'jobId',$7::uuid,'listingId',$3::uuid,
        'revision',$4::integer,'expectedVersion',$5::text,'altText',$8::text,'outcome','registered',
        'registeredAt',app_private.media_utc(created),'expiresAt',app_private.media_utc(created+interval '24 hours')),created
      FROM payload RETURNING operation_id`,
      [tenantId, context.requester, listingId, revision, expected, registrationId, jobId, altText],
    )
  ).rows[0];
  await database.query(
    `INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,requester_id,
      registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
    SELECT tenant_id,$2,operation_id,listing_id,revision_no,requester_id,requester_id,expected_version,$3,$4,$5,
      created_at,created_at+interval '24 hours' FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$6`,
    [tenantId, jobId, altText, quarantineId, outputId, registered.operation_id],
  );
  await database.query(
    `INSERT INTO app_private.media_input_captures(tenant_id,job_id,listing_id,revision_no,requester_id,
      generation_id,input_bytes,input_sha256,captured_at)
    SELECT tenant_id,id,listing_id,revision_no,requester_id,$3,100,$4,created_at FROM app_private.media_jobs WHERE tenant_id=$1 AND id=$2`,
    [tenantId, jobId, generationId, inputSha256],
  );
  await database.query(
    `INSERT INTO app_private.media_processing_leases(tenant_id,job_id,attempt,claim_id,lease_nonce,
      claimed_at,lease_expires_at,job_expires_at)
    SELECT tenant_id,id,1,$3,$4,created_at,created_at+interval '180 seconds',expires_at FROM app_private.media_jobs WHERE tenant_id=$1 AND id=$2`,
    [tenantId, jobId, claimId, leaseNonce],
  );
  await database.query(
    `INSERT INTO app_private.media_verified_outputs(tenant_id,job_id,attempt,lease_nonce,output_id,
      manifest,manifest_sha256,verified_at)
    SELECT tenant_id,id,1,$3,output_id,$4::jsonb,encode(sha256(convert_to(($4::jsonb)::text,'UTF8')),'hex'),created_at
      FROM app_private.media_jobs WHERE tenant_id=$1 AND id=$2`,
    [tenantId, jobId, leaseNonce, JSON.stringify(manifest)],
  );
  await database.query(
    `WITH payload AS (SELECT j.*,v.manifest_sha256,jsonb_build_object('kind','attach_media','tenantId',j.tenant_id,
      'actorId',j.requester_id,'listingId',j.listing_id,'revision',j.revision_no,'expectedVersion',j.expected_version::text,
      'jobId',j.id,'altText',j.alt_text,'manifestSha256',v.manifest_sha256,'outputId',j.output_id,'mediaId',$4::uuid) AS body
      FROM app_private.media_jobs j JOIN app_private.media_verified_outputs v ON v.tenant_id=j.tenant_id AND v.job_id=j.id
      WHERE j.tenant_id=$1 AND j.id=$2)
    INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
      expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    SELECT tenant_id,$3,'attach_media',listing_id,revision_no,requester_id,expected_version,$4,body,
      encode(sha256(convert_to(body::text,'UTF8')),'hex'),jsonb_build_object('kind','attach_media','operationId',$3::uuid,
      'jobId',id,'listingId',listing_id,'revision',revision_no,'expectedVersion',expected_version::text,
      'altText',alt_text,'status','ready','receipt',NULL),created_at FROM payload`,
    [tenantId, jobId, operationId, mediaId],
  );
  await database.query(
    `INSERT INTO app_private.media_attach_intents(tenant_id,operation_id,job_id,listing_id,revision_no,requester_id,
      expected_version,alt_text,output_id,manifest_sha256,media_id,created_at,request_payload,request_sha256)
    SELECT o.tenant_id,o.operation_id,j.id,o.listing_id,o.revision_no,o.requester_id,o.expected_version,j.alt_text,j.output_id,
      v.manifest_sha256,o.resource_id,o.created_at,o.request_payload,o.request_sha256 FROM app_private.media_operations o
      JOIN app_private.media_jobs j ON j.tenant_id=o.tenant_id AND j.id=$2
      JOIN app_private.media_verified_outputs v ON v.tenant_id=j.tenant_id AND v.job_id=j.id
      WHERE o.tenant_id=$1 AND o.operation_id=$3`,
    [tenantId, jobId, operationId],
  );
  await database.query(
    `INSERT INTO app_private.media_attachments(tenant_id,media_id,operation_id,job_id,listing_id,revision_no,requester_id,
      expected_version,output_id,manifest_sha256,manifest,public_object_key,sha256,content_type,bytes,width,height,alt_text,accepted)
    SELECT i.tenant_id,i.media_id,i.operation_id,i.job_id,i.listing_id,i.revision_no,i.requester_id,i.expected_version,i.output_id,
      i.manifest_sha256,v.manifest,'synthetic/'||i.tenant_id::text||'/'||i.job_id::text||'/'||i.output_id::text||'.webp',
      v.manifest->>'sha256',v.manifest->>'mimeType',(v.manifest->>'bytes')::bigint,(v.manifest->>'width')::integer,
      (v.manifest->>'height')::integer,i.alt_text,true FROM app_private.media_attach_intents i
      JOIN app_private.media_verified_outputs v ON v.tenant_id=i.tenant_id AND v.job_id=i.job_id
      WHERE i.tenant_id=$1 AND i.operation_id=$2`,
    [tenantId, operationId],
  );
  await database.query(
    `INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,
      bytes,width,height,sha256,alt_text,position,accepted,sealed_job_id,attach_operation_id,sealed_manifest_sha256)
    SELECT tenant_id,listing_id,revision_no,media_id,public_object_key,content_type,bytes,width,height,sha256,alt_text,$3,true,
      job_id,operation_id,manifest_sha256 FROM app_private.media_attachments WHERE tenant_id=$1 AND operation_id=$2`,
    [tenantId, operationId, position],
  );
  await database.query(
    `INSERT INTO app_private.media_attach_results(tenant_id,operation_id,job_id,outcome,reason,result_version,
      media_id,position,completed_at,receipt)
    SELECT tenant_id,operation_id,job_id,'applied',NULL,expected_version+1,media_id,$3,created_at,
      jsonb_build_object('kind','attach_media','operationId',operation_id,'jobId',job_id,'listingId',listing_id,'revision',revision_no,
        'expectedVersion',expected_version::text,'version',(expected_version+1)::text,'outcome','applied','reason',NULL,
        'mediaId',media_id,'position',$3::integer,'completedAt',app_private.media_utc(created_at))
      FROM app_private.media_attach_intents WHERE tenant_id=$1 AND operation_id=$2`,
    [tenantId, operationId, position],
  );
  return Object.freeze({ jobId, operationId, mediaId, sha256 });
}
