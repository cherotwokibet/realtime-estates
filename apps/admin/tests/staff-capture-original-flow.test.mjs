import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import { RealtorApiClient, validateStaffCaptureCommand } from '@realtor/api-client';
import {
  staffCaptureOriginalRequest,
  readStaffCaptureScope,
} from '../dist/tests/lib/staff-capture-original-server.js';
import { privateRecoveryRequest } from '../dist/tests/lib/private-recovery-server.js';
const origin = 'http://127.0.0.1:49105';
for (const role of ['admin', 'agent'])
  test(
    role +
      ': real signed staff-preview lease, encrypted original and GET receipt survive a lost write reply without duplicate capture',
    async (t) => {
      const old = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      t.after(() => {
        if (old === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = old;
      });
      const preview = await startStaffPreview({ enquiryPreview: 'synthetic-v1' });
      t.after(() => preview.close());
      const env = {
        NODE_ENV: 'development',
        STAFF_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
        STAFF_PREVIEW_API_ORIGIN: preview.origin,
        PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1',
        PRIVATE_RECOVERY_STORAGE_KEY: 'ca'.repeat(32),
      };
      for (const r of ['admin', 'agent'])
        Object.assign(env, {
          ['STAFF_ENQUIRY_' + r.toUpperCase() + '_TOKEN']: preview.enquiryStaff[r].bearerToken,
          ['STAFF_ENQUIRY_' + r.toUpperCase() + '_ID']: preview.enquiryStaff[r].actorId,
          ['STAFF_ENQUIRY_' + r.toUpperCase() + '_INSTANCE']: randomUUID(),
        });
      const scope = await readStaffCaptureScope(role, env);
      assert.equal(scope.actorId, preview.enquiryStaff[role].actorId);
      const req = (path, body) =>
        new Request(origin + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            host: '127.0.0.1:49105',
            origin,
            'x-preview-instance': scope.instanceId,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const command = validateStaffCaptureCommand({
        policy: 'staff-capture-command-v1',
        role,
        operationId: randomUUID(),
        input: {
          listingId: null,
          name: 'Synthetic Capture',
          email: 'synthetic@example.test',
          phone: null,
          message: 'PRIVATE_CAPTURE_CANARY',
          noticeVersion: 'synthetic-staff-notice-v1',
          noticeAcknowledged: true,
        },
      });
      const kind = 'capture-' + role;
      const sealed = await privateRecoveryRequest(
        req('/api/private-workspace/recovery/' + kind + '/seal', { scope, command }),
        kind,
        'seal',
        env,
      );
      assert.equal(sealed.status, 200);
      const envelope = await sealed.json();
      assert.doesNotMatch(JSON.stringify(envelope), /PRIVATE_CAPTURE_CANARY/);
      let writes = 0;
      const lose = async (url, init) => {
        const r = await fetch(url, init);
        if (init.method === 'POST' && url.includes('/capture-originals/')) {
          writes++;
          assert.equal(r.status, 200);
          return new Response(null, { status: 503 });
        }
        return r;
      };
      const path = '/api/enquiry-preview/' + role + '/capture-originals/' + command.operationId;
      assert.equal(
        (
          await staffCaptureOriginalRequest(
            req(path, command),
            role,
            command.operationId,
            env,
            lose,
          )
        ).status,
        503,
      );
      assert.equal(writes, 1);
      assert.equal(
        (
          await privateRecoveryRequest(
            req('/api/private-workspace/recovery/' + kind + '/open', { scope, envelope }),
            kind,
            'open',
            env,
          )
        ).status,
        200,
      );
      const recovered = await staffCaptureOriginalRequest(
        req(path),
        role,
        command.operationId,
        env,
      );
      assert.equal(recovered.status, 200);
      const receipt = await recovered.json();
      assert.deepEqual(receipt.request, command);
      assert.equal(receipt.actorId, scope.actorId);
      assert.equal(writes, 1);
      const api = new RealtorApiClient({
        baseUrl: preview.origin,
        allowLoopbackHttp: true,
        privacyNoticeVersion: 'synthetic-staff-notice-v1',
      });
      assert.deepEqual(
        await api.staffCaptureOriginal(command, {
          bearerToken: preview.enquiryStaff[role].bearerToken,
        }),
        receipt,
      );
      const duplicate = JSON.stringify(command).replace(
        '"operationId":',
        '"operationId":"' + command.operationId + '","operationId":',
      );
      const rejected = await fetch(
        preview.origin + '/v2/staff/capture-originals/' + command.operationId,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + preview.enquiryStaff[role].bearerToken,
            'Content-Type': 'application/json',
          },
          body: duplicate,
        },
      );
      assert.equal(rejected.status, 400);
      const peer = role === 'admin' ? 'agent' : 'admin';
      await assert.rejects(
        api.readStaffCaptureOriginal(command.operationId, {
          bearerToken: preview.enquiryStaff[peer].bearerToken,
        }),
        (e) => e.status === 404,
      );
    },
  );
