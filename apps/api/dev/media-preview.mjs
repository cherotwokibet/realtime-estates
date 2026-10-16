/** Explicit local synthetic composition. Owned roots are retained, never rotated or repaired. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProxy } from 'node:util/types';
import { createDurableSyntheticStore } from '@realtor/media/durable-store';
import { createSyntheticAttemptJournal } from '@realtor/media/attempt-journal';
import { createSyntheticWorkerAdmission } from '@realtor/media/worker-admission';
import { createSyntheticOneAttemptProcessor } from '@realtor/media/one-attempt';
import { createSyntheticUploadRequests } from '@realtor/media/upload-request';
import { createSyntheticProcessingRequests } from '@realtor/media/processing-request';
import { createWindowsSyntheticSupervisor } from '@realtor/media/windows-supervisor';
import { createDevelopmentUploadApi } from '../dist/upload.js';
import { createDevelopmentMediaFinalizeApi } from '../dist/media-finalize.js';
import { createDevelopmentMediaPreviewPair } from '../dist/media-preview.js';

const MODE = 'synthetic-native-v1';
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
  let journal, worker, requests, upload, finalize, images, imageRequests, closing;
  const close = () =>
    (closing ??= (async () => {
      const admissions = await Promise.allSettled([
        upload?.close(),
        finalize?.close(),
        images?.close(),
      ]);
      const resources = await Promise.allSettled([
        requests?.close(),
        worker?.close(),
        imageRequests?.close(),
      ]);
      const journalResult = await Promise.allSettled([journal?.close()]);
      const storage = await Promise.allSettled(stores.map((store) => store.close()));
      const failed = [...admissions, ...resources, ...journalResult, ...storage].find(
        (result) => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
    })());
  try {
    const attemptParent = path.join(root, 'attempts');
    await mkdir(attemptParent, { mode: 0o700 });
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
    const supervisor = await createWindowsSyntheticSupervisor({
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
    return Object.freeze({
      mode: MODE,
      handleUpload: (request, source) => upload.handle(request, source),
      handleFinalize: (request) => finalize.handle(request),
      handlePreview: (request) => images.handle(request),
      close,
    });
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
