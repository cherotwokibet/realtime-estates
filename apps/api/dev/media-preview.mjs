/** Explicit local synthetic composition. Owned roots are retained, never rotated or repaired. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProxy } from 'node:util/types';
import { createDurableSyntheticStore, retireExpiredDurableJob } from '@realtor/media/durable-store';
import { expiredMediaCleanupAuthorization } from '@realtor/media/expired-cleanup';
import { createSyntheticAttemptJournal } from '@realtor/media/attempt-journal';
import { createSyntheticWorkerAdmission } from '@realtor/media/worker-admission';
import { createSyntheticOneAttemptProcessor } from '@realtor/media/one-attempt';
import { createSyntheticUploadRequests } from '@realtor/media/upload-request';
import { createSyntheticProcessingRequests } from '@realtor/media/processing-request';
import {
  createWindowsSyntheticSupervisor,
  retireWindowsSyntheticSupervisor,
  ownsWindowsSyntheticRetirement,
} from '@realtor/media/windows-supervisor';
import { createDevelopmentUploadApi } from '../dist/upload.js';
import { createDevelopmentMediaFinalizeApi } from '../dist/media-finalize.js';
import { createDevelopmentMediaPreviewPair } from '../dist/media-preview.js';

const MODE = 'synthetic-native-v1';
const maintenanceSessions = new WeakMap();
export class NativeMediaMaintenanceError extends Error {
  constructor(code) {
    super(`Native media maintenance: ${code}.`);
    this.name = 'NativeMediaMaintenanceError';
    this.code = code;
  }
}
/** Internal original-instance capability only, never an HTTP command. */
export function prepareNativeMediaMaintenance(preview) {
  const session = maintenanceSessions.get(preview);
  if (!session) return Promise.reject(new NativeMediaMaintenanceError('INVALID_CAPABILITY'));
  return session.prepare();
}
/** Call only with a confirmed committed receipt from MediaMaintenanceDatabase. */
export function retireNativeMediaJob(preview, permit, authorization) {
  const session = maintenanceSessions.get(preview);
  if (!session) return Promise.reject(new NativeMediaMaintenanceError('INVALID_CAPABILITY'));
  return session.retire(permit, authorization);
}
class NativeMediaPreviewConfigurationError extends Error {
  constructor() {
    super(
      'Native media preview requires explicit Windows synthetic mode, trusted executable and a fresh owned local root.',
    );
    this.name = 'NativeMediaPreviewConfigurationError';
  }
}
function invalid() {
  throw new NativeMediaPreviewConfigurationError();
}
function absolute(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.includes('\0') ||
    path.parse(value).root.startsWith('\\\\')
  )
    invalid();
  return path.resolve(value);
}
/** Captures only plain own data; configuration is never selected by an HTTP request. */
export function nativeMediaPreviewConfiguration(input) {
  if (
    process.env.NODE_ENV === 'production' ||
    process.platform !== 'win32' ||
    !input ||
    typeof input !== 'object' ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 3 ||
    keys.some((key) => !['mode', 'rootDirectory', 'powerShellPath'].includes(key))
  )
    invalid();
  const values = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    values[key] = descriptor.value;
  }
  if (values.mode !== MODE) invalid();
  const rootDirectory = absolute(values.rootDirectory),
    powerShellPath = absolute(values.powerShellPath);
  if (!/^(?:pwsh|powershell)\.exe$/i.test(path.basename(powerShellPath))) invalid();
  return Object.freeze({ mode: MODE, rootDirectory, powerShellPath });
}
const canonical = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
async function checkedDirectory(location) {
  const stat = await lstat(location, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    canonical(path.resolve(await realpath(location))) !== canonical(location)
  )
    invalid();
  return stat;
}
async function checkedAncestry(location) {
  for (;;) {
    await checkedDirectory(location);
    const parent = path.dirname(location);
    if (parent === location) return;
    location = parent;
  }
}
async function rootUnchanged(root, identity) {
  const stat = await checkedDirectory(root);
  if (
    stat.dev !== identity.dev ||
    stat.ino !== identity.ino ||
    stat.birthtimeNs !== identity.birthtimeNs
  )
    invalid();
}
async function exclusiveRecord(root, name, value, identity) {
  await rootUnchanged(root, identity);
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > 8192) invalid();
  const file = await open(path.join(root, name), 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await rootUnchanged(root, identity);
}
async function knownRoot(root, expected, identity) {
  await rootUnchanged(root, identity);
  const directory = await opendir(root),
    seen = new Set();
  try {
    for (;;) {
      const entry = await directory.read();
      if (!entry) break;
      if (!expected.has(entry.name) || seen.has(entry.name) || entry.isSymbolicLink()) invalid();
      seen.add(entry.name);
      const stat = await lstat(path.join(root, entry.name));
      if (
        stat.isSymbolicLink() ||
        (expected.get(entry.name) === 'directory'
          ? !stat.isDirectory()
          : !stat.isFile() || stat.nlink !== 1)
      )
        invalid();
    }
  } finally {
    await directory.close();
  }
  if (seen.size !== expected.size) invalid();
  await rootUnchanged(root, identity);
}

/**
 * One fixed root set, worker admission and supervisor for this disposable database.
 * A nonempty/partial prior root is deliberately unsupported, not restarted.
 * Unknown native work remains retained and blocks its existing worker/supervisor.
 */
export async function createNativeMediaPreview({
  nativeUploads,
  tenant,
  database,
  coordinator,
  verifyBearer,
}) {
  const config = nativeMediaPreviewConfiguration(nativeUploads),
    root = config.rootDirectory;
  let configuredTenantId;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(tenant, 'tenantId');
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        descriptor.value,
      )
    )
      invalid();
    configuredTenantId = descriptor.value.toLowerCase();
  } catch {
    invalid();
  }
  await checkedAncestry(root);
  const identity = await checkedDirectory(root),
    directory = await opendir(root);
  try {
    if (await directory.read()) invalid();
  } finally {
    await directory.close();
  }
  const executable = await lstat(config.powerShellPath);
  if (
    !executable.isFile() ||
    executable.isSymbolicLink() ||
    executable.nlink !== 1 ||
    canonical(path.resolve(await realpath(config.powerShellPath))) !==
      canonical(config.powerShellPath)
  )
    invalid();
  await exclusiveRecord(
    root,
    'preview-owner.json',
    {
      version: 1,
      mode: MODE,
      ownerId: randomUUID(),
      processId: process.pid,
      createdAt: new Date().toISOString(),
      disposableDatabase: true,
    },
    identity,
  );
  const stores = [];
  let journal,
    worker,
    requests,
    upload,
    finalize,
    images,
    imageRequests,
    closing,
    preparing,
    supervisor;
  let maintenanceDrain = Promise.resolve();
  let byteAdmissionsFenced = false;
  const unavailable = () =>
    Response.json(
      { error: 'SERVICE_UNAVAILABLE' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      },
    );
  const close = () => {
    byteAdmissionsFenced = true;
    return (closing ??= (async () => {
      await Promise.allSettled([preparing, maintenanceDrain]);
      const admissions = await Promise.allSettled([
        upload?.close(),
        finalize?.close(),
        images?.close(),
      ]);
      const retired = await Promise.allSettled([
        supervisor ? retireWindowsSyntheticSupervisor(supervisor) : undefined,
      ]);
      const resources = await Promise.allSettled([
        requests?.close(),
        worker?.close(),
        imageRequests?.close(),
      ]);
      const journalResult = await Promise.allSettled([journal?.close()]);
      const storage = await Promise.allSettled(stores.map((store) => store.close()));
      const failed = [...admissions, ...retired, ...resources, ...journalResult, ...storage].find(
        (result) => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
    })());
  };
  try {
    const attemptParent = path.join(root, 'attempts');
    await mkdir(attemptParent, { mode: 0o700 });
    const attemptIdentity = await checkedDirectory(attemptParent);
    async function store() {
      const result = await createDurableSyntheticStore(root);
      stores.push(result);
      return result;
    }
    const photos = await store(),
      processing = await store(),
      journalStore = await store(),
      transport = await store();
    journal = await createSyntheticAttemptJournal({ store: journalStore, attemptParent });
    worker = await createSyntheticWorkerAdmission({ parentDirectory: root, journal });
    requests = await createSyntheticUploadRequests({ store: transport });
    supervisor = await createWindowsSyntheticSupervisor({
      powerShellPath: config.powerShellPath,
      attemptParent,
    });
    const codecEntryPath = fileURLToPath(
      new URL('../../../packages/media/dist/codec-worker.js', import.meta.url),
    );
    const createProcessor = () =>
      createSyntheticOneAttemptProcessor({
        coordinator,
        inputStore: photos,
        requestStore: processing,
        worker,
        journal,
        supervisor,
        nodeExecutablePath: process.execPath,
        codecEntryPath,
      });
    upload = createDevelopmentUploadApi({
      tenant,
      database,
      verifyBearer,
      requests,
      createProcessor,
    });
    finalize = createDevelopmentMediaFinalizeApi({ tenant, database, verifyBearer, coordinator });
    imageRequests = await createSyntheticProcessingRequests({ store: processing });
    images = createDevelopmentMediaPreviewPair({
      tenant,
      database,
      verifyBearer,
      processingRequests: imageRequests,
      outputStore: photos,
    });
    const expected = new Map([
      ['preview-owner.json', 'file'],
      ['attempts', 'directory'],
      ...stores.map((store) => [path.basename(store.rootDirectory), 'directory']),
      [path.basename(worker.rootDirectory), 'directory'],
    ]);
    await knownRoot(root, expected, identity);
    await exclusiveRecord(
      root,
      'preview-resources.json',
      {
        version: 1,
        mode: MODE,
        attemptParent: 'attempts',
        stores: {
          photos: { root: path.basename(photos.rootDirectory), id: photos.storeId },
          processing: { root: path.basename(processing.rootDirectory), id: processing.storeId },
          journal: { root: path.basename(journalStore.rootDirectory), id: journalStore.storeId },
          transport: { root: path.basename(transport.rootDirectory), id: transport.storeId },
        },
        worker: {
          root: path.basename(worker.rootDirectory),
          id: worker.workerId,
          journalId: worker.journalId,
        },
      },
      identity,
    );
    expected.set('preview-resources.json', 'file');
    await knownRoot(root, expected, identity);
    let permit = null,
      retirement = null,
      maintenanceActive = false;
    async function guardAttemptParent() {
      await rootUnchanged(root, identity);
      await rootUnchanged(attemptParent, attemptIdentity);
      await knownRoot(root, expected, identity);
    }
    async function preflightAttempt(jobId) {
      await guardAttemptParent();
      const directory = path.join(attemptParent, jobId);
      let owned;
      try {
        owned = await checkedDirectory(directory);
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
      const known = new Map([
        ['source.input', 10485760n],
        ['converted.webp', 10485760n],
        ['manifest.json', 65536n],
      ]);
      const handle = await opendir(directory),
        files = [];
      try {
        for (;;) {
          const item = await handle.read();
          if (!item) break;
          if (files.length >= 3 || !known.has(item.name) || item.isSymbolicLink() || !item.isFile())
            throw new NativeMediaMaintenanceError('INTEGRITY');
          const location = path.join(directory, item.name),
            snapshot = await lstat(location, { bigint: true });
          if (
            !snapshot.isFile() ||
            snapshot.isSymbolicLink() ||
            snapshot.nlink !== 1n ||
            snapshot.size < 0n ||
            snapshot.size > known.get(item.name)
          )
            throw new NativeMediaMaintenanceError('INTEGRITY');
          files.push({ location, snapshot });
        }
      } finally {
        await handle.close();
      }
      await rootUnchanged(directory, owned);
      await guardAttemptParent();
      return { directory, identity: owned, files };
    }
    function prepare() {
      if (process.env.NODE_ENV === 'production')
        return Promise.reject(new NativeMediaMaintenanceError('PRODUCTION_DISABLED'));
      if (closing) return Promise.reject(new NativeMediaMaintenanceError('CLOSED'));
      byteAdmissionsFenced = true;
      preparing ??= (async () => {
        // Every exposed byte writer/finalizer/reader fences admission synchronously
        // before we await their already admitted work. No forced process killing.
        const closed = await Promise.allSettled([upload.close(), finalize.close(), images.close()]);
        if (closed.some((r) => r.status === 'rejected'))
          throw new NativeMediaMaintenanceError('NOT_READY');
        retirement = await retireWindowsSyntheticSupervisor(supervisor);
        if (!retirement || !ownsWindowsSyntheticRetirement(supervisor, retirement)) return null;
        const state = await worker.inspect();
        if (state.state !== 'idle') return null;
        const drained = await Promise.allSettled([
          requests.close(),
          imageRequests.close(),
          worker.close(),
          journal.close(),
        ]);
        if (drained.some((r) => r.status === 'rejected'))
          throw new NativeMediaMaintenanceError('NOT_READY');
        await guardAttemptParent();
        permit = Object.freeze({ kind: 'native_media_maintenance' });
        return permit;
      })();
      return preparing;
    }
    async function retire(selectedPermit, value) {
      if (process.env.NODE_ENV === 'production')
        throw new NativeMediaMaintenanceError('PRODUCTION_DISABLED');
      let authorization;
      try {
        authorization = expiredMediaCleanupAuthorization(value);
      } catch {
        throw new NativeMediaMaintenanceError('INVALID_AUTHORIZATION');
      }
      if (closing) throw new NativeMediaMaintenanceError('CLOSED');
      if (
        !permit ||
        selectedPermit !== permit ||
        !ownsWindowsSyntheticRetirement(supervisor, retirement)
      )
        throw new NativeMediaMaintenanceError('INVALID_CAPABILITY');
      if (authorization.tenantId !== configuredTenantId)
        throw new NativeMediaMaintenanceError('INVALID_AUTHORIZATION');
      if (maintenanceActive) throw new NativeMediaMaintenanceError('BUSY');
      maintenanceActive = true;
      let finish;
      maintenanceDrain = new Promise((resolve) => {
        finish = resolve;
      });
      try {
        const attempt = await preflightAttempt(authorization.jobId);
        const stored = await retireExpiredDurableJob(
          photos,
          authorization,
          async () => !!permit && ownsWindowsSyntheticRetirement(supervisor, retirement),
        );
        let removedFiles = 0,
          removedBytes = 0;
        if (attempt)
          for (const file of attempt.files) {
            await guardAttemptParent();
            await rootUnchanged(attempt.directory, attempt.identity);
            const stat = await lstat(file.location, { bigint: true }),
              before = file.snapshot;
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              stat.nlink !== 1n ||
              stat.dev !== before.dev ||
              stat.ino !== before.ino ||
              stat.birthtimeNs !== before.birthtimeNs ||
              stat.size !== before.size ||
              stat.mtimeNs !== before.mtimeNs
            )
              throw new NativeMediaMaintenanceError('INTEGRITY');
            await unlink(file.location);
            removedFiles++;
            removedBytes += Number(before.size);
          }
        // Keep the empty owned attempt directory and all immutable journal facts.
        return Object.freeze({
          jobId: authorization.jobId,
          operationId: authorization.operationId,
          store: stored,
          attempt: Object.freeze({ removedFiles, removedBytes }),
        });
      } finally {
        maintenanceActive = false;
        finish();
      }
    }
    const result = Object.freeze({
      mode: MODE,
      handleUpload: (request, source) =>
        byteAdmissionsFenced ? Promise.resolve(unavailable()) : upload.handle(request, source),
      handleFinalize: (request) =>
        byteAdmissionsFenced ? Promise.resolve(unavailable()) : finalize.handle(request),
      handlePreview: (request) =>
        byteAdmissionsFenced ? Promise.resolve(unavailable()) : images.handle(request),
      close,
    });
    maintenanceSessions.set(result, { prepare, retire });
    return result;
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

// Floor-plan composition uses its own fresh root and capability surface. No photo maintenance hooks.
import {
  createFloorPlanRequests,
  createFloorPlanSourceAdmission,
} from '@realtor/media/floor-plan-request';
import { createFloorPlanProcessor } from '@realtor/media/floor-plan-processing';
import {
  createFloorPlanOutputDelivery,
  FloorPlanSealUncertainError,
} from '@realtor/media/floor-plan-output';
import {
  createFloorPlanPreparation,
  FloorPlanPreparationUncertainError,
} from '@realtor/media/floor-plan-preparation';
import { assertSafeFloorPlanCoordinatorConnection } from '@realtor/media/coordinator-database';
export async function createNativeFloorPlanPreview({
  nativeFloorPlan,
  publicationMode,
  tenantId,
  database,
  mediaPool,
}) {
  if (publicationMode !== undefined && publicationMode !== 'synthetic-floor-plan-publication-v1')
    invalid();
  const publicationEnabled = publicationMode === 'synthetic-floor-plan-publication-v1';
  const config = nativeMediaPreviewConfiguration(nativeFloorPlan),
    root = config.rootDirectory;
  if (
    typeof tenantId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId) ||
    typeof database?.transaction !== 'function' ||
    typeof mediaPool?.connect !== 'function'
  )
    invalid();
  const check = await mediaPool.connect();
  let unsafe = true;
  try {
    await assertSafeFloorPlanCoordinatorConnection(check);
    unsafe = false;
  } finally {
    check.release(unsafe);
  }
  await checkedAncestry(root);
  const identity = await checkedDirectory(root),
    directory = await opendir(root);
  try {
    if (await directory.read()) invalid();
  } finally {
    await directory.close();
  }
  const executable = await lstat(config.powerShellPath);
  if (
    !executable.isFile() ||
    executable.isSymbolicLink() ||
    executable.nlink !== 1 ||
    canonical(path.resolve(await realpath(config.powerShellPath))) !==
      canonical(config.powerShellPath)
  )
    invalid();
  await exclusiveRecord(
    root,
    'floor-plan-owner.json',
    { version: 1, ownerId: randomUUID(), processId: process.pid, disposableDatabase: true },
    identity,
  );
  const stores = [];
  let requests, journal, worker, supervisor, processor, delivery, preparation, closing;
  let fenced = false;
  const close = () => {
    fenced = true;
    return (closing ??= (async () => {
      await preparation?.close();
      await delivery?.close();
      if (supervisor) {
        const retirement = await retireWindowsSyntheticSupervisor(supervisor);
        if (!retirement || !ownsWindowsSyntheticRetirement(supervisor, retirement))
          throw Error('Floor-plan native retirement is unconfirmed; owned resources retained.');
      }
      for (const resource of [processor, requests, worker, journal, ...stores])
        await resource?.close();
    })());
  };
  const api = (t, sql, args) =>
    database.transaction(
      { tenantId: t.companyId, actorId: t.actorId, correlationId: randomUUID() },
      async (q) => {
        const result = await q.query(sql, args);
        if (result.rows.length !== 1 || !Object.hasOwn(result.rows[0], 'value'))
          throw Error('Invalid floor-plan SQL result');
        return result.rows[0].value;
      },
    );
  async function media(t, sql, args, uncertainty) {
    const client = await mediaPool.connect();
    let began = false,
      commit = false,
      destroy = false;
    try {
      await assertSafeFloorPlanCoordinatorConnection(client);
      await client.query('BEGIN');
      began = true;
      await client.query('SET LOCAL ROLE media_coordinator');
      await client.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [t.companyId, t.actorId],
      );
      const result = await client.query(sql, args);
      if (result.rows.length !== 1 || !Object.hasOwn(result.rows[0], 'value'))
        throw Error('Invalid floor-plan coordinator result');
      commit = true;
      await client.query('COMMIT');
      began = false;
      return result.rows[0].value;
    } catch (error) {
      if (!began || commit) destroy = true;
      if (began)
        try {
          await client.query('ROLLBACK');
        } catch {
          destroy = true;
        }
      if (commit && uncertainty === 'claim') throw new FloorPlanPreparationUncertainError();
      if (commit && uncertainty === 'seal') throw new FloorPlanSealUncertainError();
      throw error;
    } finally {
      client.release(destroy);
    }
  }
  try {
    async function store() {
      const s = await createDurableSyntheticStore(root);
      stores.push(s);
      return s;
    }
    const inputStore = await store(),
      requestStore = await store(),
      journalStore = await store(),
      outputStore = await store(),
      metadataStore = await store();
    const attemptParent = path.join(root, 'attempts');
    await mkdir(attemptParent, { mode: 0o700 });
    journal = await createSyntheticAttemptJournal({ store: journalStore, attemptParent });
    worker = await createSyntheticWorkerAdmission({ parentDirectory: root, journal });
    requests = createFloorPlanRequests({ inputStore, requestStore });
    supervisor = await createWindowsSyntheticSupervisor({
      powerShellPath: config.powerShellPath,
      attemptParent,
    });
    const preflight = (t) =>
      media(t, 'SELECT app_media.preflight_synthetic_floor_plan_worker($1,$2,$3,$4,$5) AS value', [
        t.listingId,
        t.revision,
        t.requestId,
        t.claimId,
        t.leaseNonce,
      ]);
    const sourceAdmission = createFloorPlanSourceAdmission({
      requests,
      preflight: (t) =>
        api(t, 'SELECT app_api.preflight_synthetic_floor_plan($1,$2,$3) AS value', [
          t.listingId,
          t.revision,
          t.requestId,
        ]),
    });
    processor = await createFloorPlanProcessor({
      requests,
      journal,
      worker,
      preflight,
      supervisor,
    });
    delivery = createFloorPlanOutputDelivery({
      processor,
      requests,
      outputStore,
      metadataStore,
      preflight,
      seal: (t, outputId, manifest) =>
        media(
          t,
          'SELECT app_media.seal_synthetic_floor_plan($1,$2,$3,$4,$5,$6,$7) AS value',
          [t.listingId, t.revision, t.requestId, t.claimId, t.leaseNonce, outputId, manifest],
          'seal',
        ),
      readSeal: (t) =>
        media(t, 'SELECT app_media.read_synthetic_floor_plan_output($1,$2,$3) AS value', [
          t.listingId,
          t.revision,
          t.requestId,
        ]),
      ...(publicationEnabled
        ? {
            readPublishedGallery: (t) =>
              api(
                { ...t, actorId: null },
                'SELECT app_api.read_synthetic_published_floor_plan_output($1,$2,$3) AS value',
                [t.listingId, t.revision, t.approvedVersion],
              ),
          }
        : {}),
      readGallery: (t) =>
        api(t, 'SELECT app_api.read_synthetic_floor_plan_gallery($1,$2) AS value', [
          t.listingId,
          t.revision,
        ]),
    });
    preparation = createFloorPlanPreparation({
      requests,
      sourceAdmission,
      delivery,
      register: (t, s) =>
        api(t, 'SELECT app_api.register_synthetic_floor_plan($1,$2,$3,$4,$5,$6,$7) AS value', [
          t.listingId,
          t.revision,
          t.expectedVersion,
          t.requestId,
          s.sha256,
          s.bytes,
          s.format,
        ]),
      readRegistration: (t) =>
        api(t, 'SELECT app_api.read_synthetic_floor_plan_registration($1,$2) AS value', [
          t.listingId,
          t.requestId,
        ]),
      claim: (t, claim) =>
        media(
          t,
          'SELECT app_media.claim_synthetic_floor_plan($1,$2,$3,$4) AS value',
          [t.listingId, t.revision, t.requestId, claim],
          'claim',
        ),
      readLease: (t) =>
        media(t, 'SELECT app_media.read_synthetic_floor_plan_lease($1,$2,$3) AS value', [
          t.listingId,
          t.revision,
          t.requestId,
        ]),
    });
    const expected = new Map([
      ['floor-plan-owner.json', 'file'],
      ['attempts', 'directory'],
      ...stores.map((s) => [path.basename(s.rootDirectory), 'directory']),
      [path.basename(worker.rootDirectory), 'directory'],
    ]);
    await knownRoot(root, expected, identity);
    await exclusiveRecord(
      root,
      'floor-plan-resources.json',
      {
        version: 1,
        stores: stores.map((s) => path.basename(s.rootDirectory)),
        worker: path.basename(worker.rootDirectory),
      },
      identity,
    );
    const target = (ctx, c) => {
      if (fenced || ctx.tenantId !== tenantId) throw Error('Floor-plan preview unavailable.');
      return {
        companyId: tenantId,
        actorId: ctx.actorId,
        listingId: c.listingId,
        revision: c.revision,
        requestId: c.requestId,
        expectedVersion: Number(c.expectedVersion),
      };
    };
    return Object.freeze({
      prepare: (ctx, c, source) => preparation.prepare(target(ctx, c), source),
      recover: (ctx, c) => preparation.recover(target(ctx, c)),
      ...(publicationEnabled
        ? {
            readPublishedImage: (ctx, listingId, revision, approvedVersion) => {
              if (fenced || ctx.tenantId !== tenantId || ctx.actorId !== null)
                throw Error('Published floor-plan preview unavailable.');
              return delivery.readPublished({
                companyId: tenantId,
                listingId,
                revision,
                approvedVersion,
              });
            },
          }
        : {}),
      readImage: (ctx, listingId, revision) => {
        if (fenced || ctx.tenantId !== tenantId) throw Error('Floor-plan preview unavailable.');
        return delivery.readAttached({
          companyId: tenantId,
          actorId: ctx.actorId,
          listingId,
          revision,
        });
      },
      close,
    });
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
