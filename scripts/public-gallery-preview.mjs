/** Owned local synthetic browser fixture. Never prints or passes staff identity to web. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
import { publishNativeGallery } from '../apps/api/dev/public-gallery-fixture.mjs';
if (
  process.env.NODE_ENV === 'production' ||
  process.env.PUBLIC_GALLERY_PREVIEW !== 'synthetic-native-v1' ||
  process.platform !== 'win32'
)
  throw Error('Choose explicit Windows synthetic public gallery preview.');
const port = process.env.PUBLIC_GALLERY_UI_PORT;
if (!port || !/^[1-9]\d{3,4}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw Error('Choose an explicit local UI port.');
const root = await mkdtemp(path.join(tmpdir(), 'realtor-public-browser-'));
let preview,
  child,
  lines,
  stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  lines?.close();
  process.stdin.pause();
  child?.kill();
  await preview?.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void close());
try {
  preview = await startStaffPreview({
    port: 0,
    actor: 'admin',
    tenantSlug: process.env.TENANT_SLUG ?? 'realtime-estates',
    nativeUploads: {
      mode: 'synthetic-native-v1',
      rootDirectory: root,
      powerShellPath: path.join(
        homedir(),
        '.cache',
        'codex-runtimes',
        'codex-primary-runtime',
        'dependencies',
        'native',
        'powershell',
        'pwsh.exe',
      ),
    },
  });
  const { api, options, property } = await publishNativeGallery(preview);
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith('STAFF_PREVIEW_') ||
      key.startsWith('WEB_ENQUIRY_') ||
      ['WEB_CATALOGUE_SEARCH', 'WEB_CATALOGUE_REFERENCE'].includes(key)
    )
      delete env[key];
  child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
      'dev',
      'apps/web',
      '-p',
      port,
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit',
      env: {
        ...env,
        NODE_ENV: 'development',
        TENANT_SLUG: preview.tenantSlug,
        WEB_CATALOGUE_MODE: 'connected',
        WEB_CATALOGUE_DATA: 'synthetic',
        API_ORIGIN: preview.origin,
        ALLOW_LOOPBACK_API: 'true',
        WEB_PUBLIC_MEDIA_MODE: 'synthetic-native-v1',
      },
    },
  );
  // Omitted flags, rather than empty unsupported values, select the ordinary catalogue.
  child.on('error', () => {
    console.error('Owned public preview could not start.');
    process.exitCode = 1;
    void close();
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
    void close();
  });
  console.log(`Synthetic public gallery: http://127.0.0.1:${port}/properties/${property.id}`);
  console.log(`Retained owned synthetic root: ${root}`);
  console.log(
    'Four actual uploaded/converted/attached/approved fictional images. No production or operator acceptance.',
  );
  console.log(
    'Owned fixture commands on stdin: pause, resume, close. They affect only this disposable synthetic listing.',
  );
  lines = createInterface({ input: process.stdin });
  let tail = Promise.resolve();
  lines.on('line', (line) => {
    tail = tail
      .then(async () => {
        if (stopping) return;
        const command = line.trim();
        if (command === 'close') {
          await close();
          return;
        }
        if (command !== 'pause' && command !== 'resume') {
          console.log('Unknown synthetic fixture command refused.');
          return;
        }
        const listing = await api.getStaffListingV2(property.id, options);
        const result = await api.controlListingV2(
          {
            operationId: randomUUID(),
            kind: 'set_publication',
            listingId: property.id,
            expectedListingVersion: listing.version,
            publicationStatus: command === 'pause' ? 'paused' : 'published',
          },
          options,
        );
        if (result.decision.outcome !== 'applied')
          throw Error('Synthetic publication control refused.');
        console.log(`Owned synthetic listing now ${command === 'pause' ? 'paused' : 'published'}.`);
      })
      .catch(() => {
        console.error('Synthetic fixture command failed; no automatic retry.');
      });
  });
} catch {
  console.error('Synthetic public gallery preparation failed; root retained.');
  process.exitCode = 1;
  await close();
}
