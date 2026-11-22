/** Fresh owned test process; no bearer/signing/wrapping/recovery keys are printed. */
import { syntheticRecoveryLaunchEnvironment } from '../../../../scripts/synthetic-recovery-launch.mjs';
import { startRecoveryLedgerFixture } from './recovery-ledger-fixture.mjs';
import { ledgerTestProtection } from './recovery-ledger-protection.mjs';
import { privateRecoveryRequest } from '../../dist/tests/lib/private-recovery-server.js';
import { companySettingsBoundary } from '../../dist/tests/lib/company-settings-server.js';
import { RealtorApiClient } from '@realtor/api-client';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 262144) throw Error('Fixture input too large');
}
const data = JSON.parse(input);
let fixture,
  startedAuthority = false;
let result;
try {
  const launch = await syntheticRecoveryLaunchEnvironment(
    {
      NODE_ENV: 'development',
      PRIVATE_RECOVERY_CUSTODY_MODE: 'synthetic-windows-owner-v1',
      PRIVATE_RECOVERY_CUSTODY_FILE: data.file,
      PRIVATE_RECOVERY_CUSTODY_ID: data.custodyId,
    },
    'realtime-estates',
    ledgerTestProtection(data.testWrappingKey),
  );
  fixture = await startRecoveryLedgerFixture(data);
  startedAuthority = true;
  const config = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: fixture.origin,
    STAFF_PREVIEW_TOKEN: fixture.bearerToken,
    STAFF_PREVIEW_INSTANCE: data.instanceOverride ?? launch.instances.staff,
    ...launch.environment,
  };
  const api = new RealtorApiClient({
      baseUrl: fixture.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic-ledger490',
    }),
    lease = await api.getCurrentStaffAccessLeaseV2({ bearerToken: fixture.bearerToken });
  const scope = data.envelope?.scope ?? {
    instanceId: launch.instances.staff,
    tenantId: lease.tenantId,
    actorId: lease.actorId,
  };
  const request = (path, method = 'POST', body) =>
    new Request('http://127.0.0.1:49901' + path, {
      method,
      headers: {
        host: '127.0.0.1:49901',
        origin: 'http://127.0.0.1:49901',
        'x-preview-instance': config.STAFF_PREVIEW_INSTANCE,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const action = data.action === 'seal-and-commit' ? 'seal' : 'open';
  const opened = await privateRecoveryRequest(
    request('/api/private-workspace/recovery/settings/' + action, 'POST', {
      scope,
      ...(action === 'seal' ? { command: data.command } : { envelope: data.envelope }),
    }),
    'settings',
    action,
    config,
  );
  const value = await opened.json();
  result = {
    workerPid: process.pid,
    signingFingerprint: fixture.signingFingerprint,
    startedAuthority,
    status: opened.status,
    protection:
      process.platform === 'win32' ? 'windows-current-user-dpapi-v1' : 'owned-disposable-test-v1',
    writeRequests: 0,
  };
  if (opened.status === 200) {
    if (action === 'seal') {
      result.envelope = value;
      const response = await companySettingsBoundary(
        request(
          '/api/company-settings/operations/' + data.command.operationId,
          'POST',
          data.command,
        ),
        data.command.operationId,
        config,
      );
      result.status = response.status;
      await response.body?.cancel();
    } else {
      result.opened = true;
      const path = '/api/company-settings/operations/' + value.operationId;
      const recovered = await companySettingsBoundary(
        request(path, 'GET'),
        value.operationId,
        config,
      );
      result.status = recovered.status;
      if (recovered.status === 200) {
        result.receipt = await recovered.json();
        const replay = await companySettingsBoundary(
          request(path, 'POST', value),
          value.operationId,
          config,
        );
        result.replayStatus = replay.status;
        result.replayReceipt = await replay.json();
      } else await recovered.body?.cancel();
    }
  }
  result.writeRequests = fixture.writeRequests();
  Object.assign(result, await fixture.inspect());
} catch {
  result = {
    workerPid: process.pid,
    status: 503,
    error: 'OWNED_LEDGER_RECOVERY_UNAVAILABLE',
    startedAuthority,
  };
} finally {
  await fixture?.close();
}
console.log(JSON.stringify(result));
