/** Owned disposable-process fixture. Secrets enter only through local custody; never print them. */
import { syntheticRecoveryLaunchEnvironment } from '../../../../scripts/synthetic-recovery-launch.mjs';
import { startStaffPreview } from '../../../api/dev/staff-preview.mjs';
import { RealtorApiClient } from '@realtor/api-client';
import { privateRecoveryRequest } from '../../dist/tests/lib/private-recovery-server.js';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 262144) throw Error('Fixture too large');
}
const data = JSON.parse(input);
let preview,
  startedAuthority = false;
try {
  const env = {
    NODE_ENV: 'development',
    PRIVATE_RECOVERY_CUSTODY_MODE: 'synthetic-windows-owner-v1',
    PRIVATE_RECOVERY_CUSTODY_FILE: data.file,
    PRIVATE_RECOVERY_CUSTODY_ID: data.custodyId,
  };
  const launch = await syntheticRecoveryLaunchEnvironment(env, 'realtime-estates');
  preview = await startStaffPreview({
    port: 0,
    actor: data.role ?? 'admin',
    seedAcceptedMedia: false,
  });
  startedAuthority = true;
  const api = new RealtorApiClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic-v1',
    }),
    lease = await api.getCurrentStaffAccessLeaseV2({ bearerToken: preview.bearerToken }),
    scope = data.envelope?.scope ?? {
      instanceId: launch.instances.staff,
      tenantId: lease.tenantId,
      actorId: lease.actorId,
    };
  const settings = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: preview.origin,
    STAFF_PREVIEW_TOKEN: preview.bearerToken,
    STAFF_PREVIEW_INSTANCE: launch.instances.staff,
    ...launch.environment,
  };
  const body =
    data.action === 'seal' ? { scope, command: data.command } : { scope, envelope: data.envelope };
  const request = new Request(
    'http://127.0.0.1:49901/api/private-workspace/recovery/settings/' + data.action,
    {
      method: 'POST',
      headers: {
        host: '127.0.0.1:49901',
        origin: 'http://127.0.0.1:49901',
        'content-type': 'application/json',
        'x-preview-instance': launch.instances.staff,
      },
      body: JSON.stringify(body),
    },
  );
  let leaseReads = 0;
  const response = await privateRecoveryRequest(
    request,
    'settings',
    data.action,
    settings,
    async (url, init) => {
      if (String(url).endsWith('/v2/staff/session-lease')) leaseReads++;
      return fetch(url, init);
    },
  );
  console.log(
    JSON.stringify({
      workerPid: process.pid,
      mode: launch.mode,
      instanceId: launch.instances.staff,
      status: response.status,
      leaseReads,
      value: await response.json(),
      startedAuthority,
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      workerPid: process.pid,
      status: 503,
      error: 'CUSTODY_UNAVAILABLE',
      startedAuthority,
    }),
  );
} finally {
  await preview?.close();
}
