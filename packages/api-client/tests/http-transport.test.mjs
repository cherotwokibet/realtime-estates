import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { ApiClientError, RealtorApiClient } from '../dist/index.js';

// These tests exercise Node's real Fetch implementation against local HTTP sockets.
// They do not establish browser/CORS, React Native transport, deployed auth, or SQL idempotency behavior.
const noticeVersion = 'synthetic-http-transport-v1';

function enquiry() {
  return {
    name: `Synthetic transport guest ${randomUUID()}`,
    email: `transport-${randomUUID()}@example.invalid`,
    message: `Synthetic enquiry used only in a local transport test: ${randomUUID()}`,
    origin: 'web',
    noticeVersion,
    noticeAcknowledged: true,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function respondJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function listen(handler) {
  const errors = [];
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(error => {
      errors.push(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    errors,
    async close() {
      const closed = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      // Dispose of aborted and keep-alive sockets without waiting for idle timeouts.
      server.closeAllConnections();
      await closed;
    },
  };
}

function client(origin) {
  return new RealtorApiClient({
    baseUrl: origin,
    privacyNoticeVersion: noticeVersion,
    allowLoopbackHttp: true,
    timeoutMs: 2000,
  });
}

for (const redirectStatus of [302, 303, 307, 308]) {
  test(`Node Fetch refuses cross-origin ${redirectStatus} POST redirect before contacting destination`, { timeout: 5000 }, async t => {
    const destinationRequests = [];
    const originRequests = [];
    const receiptId = randomUUID();
    const destination = await listen(async (request, response) => {
      destinationRequests.push({
        method: request.method,
        body: await readBody(request),
        authorization: request.headers.authorization,
        key: request.headers['idempotency-key'],
      });
      // A followed redirect receives a valid receipt, making accidental forwarding observable.
      respondJson(response, 201, { id: receiptId });
    });
    t.after(async () => {
      await destination.close();
      assert.deepEqual(destination.errors, []);
    });
    const origin = await listen(async (request, response) => {
      originRequests.push({
        path: request.url,
        method: request.method,
        body: await readBody(request),
        authorization: request.headers.authorization,
        key: request.headers['idempotency-key'],
      });
      response.writeHead(redirectStatus, { Location: `${destination.origin}/capture` });
      response.end();
    });
    t.after(async () => {
      await origin.close();
      assert.deepEqual(origin.errors, []);
    });
    assert.notEqual(origin.origin, destination.origin);
    const body = enquiry();
    const bearerToken = randomBytes(32).toString('base64url');
    const idempotencyKey = randomUUID();

    await assert.rejects(
      client(origin.origin).submitEnquiry(body, { idempotencyKey, bearerToken }),
      error => {
        assert.ok(error instanceof ApiClientError);
        // Node rejects redirect:'error' with a Fetch TypeError; the client maps it to NETWORK.
        assert.equal(error.kind, 'NETWORK');
        assert.equal(error.submissionUncertain, true);
        return true;
      },
    );

    assert.equal(originRequests.length, 1);
    assert.equal(originRequests[0].path, '/v1/enquiries');
    assert.equal(originRequests[0].method, 'POST');
    assert.equal(originRequests[0].authorization, `Bearer ${bearerToken}`);
    assert.equal(originRequests[0].key, idempotencyKey);
    assert.equal(JSON.parse(originRequests[0].body).message, body.message);
    assert.deepEqual(destinationRequests, [], 'Redirect destination must receive no request, body or bearer token.');
  });
}

test('Node Fetch marks a committed POST timeout uncertain; manual same-key/body retry returns its original receipt', { timeout: 6000 }, async t => {
  const records = new Map();
  const requests = [];
  let commitCount = 0;
  const origin = await listen(async (request, response) => {
    const body = await readBody(request);
    const key = request.headers['idempotency-key'];
    requests.push({ path: request.url, method: request.method, body, key, authorization: request.headers.authorization });
    const existing = records.get(key);
    if (existing && existing.body !== body) {
      respondJson(response, 409, {
        error: { code: 'CONFLICT', message: 'An idempotency key cannot identify a different enquiry.' },
        requestId: randomUUID(),
      });
      return;
    }
    const record = existing ?? { body, receipt: { id: randomUUID() } };
    if (!existing) {
      records.set(key, record);
      commitCount += 1;
    }
    if (requests.length === 1) {
      // Simulate durable acceptance followed by an unavailable receipt. The client's deadline
      // aborts this real HTTP socket; no timer or automatic retry is used by the fixture server.
      return;
    }
    respondJson(response, 201, record.receipt);
  });
  t.after(async () => {
    await origin.close();
    assert.deepEqual(origin.errors, []);
  });

  const api = client(origin.origin);
  const body = enquiry();
  const bearerToken = randomBytes(32).toString('base64url');
  const idempotencyKey = randomUUID();
  await assert.rejects(
    api.submitEnquiry(body, { idempotencyKey, bearerToken, timeoutMs: 750 }),
    error => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.kind, 'TIMEOUT');
      assert.equal(error.submissionUncertain, true);
      return true;
    },
  );

  assert.equal(requests.length, 1, 'The client must not automatically retry an uncertain POST.');
  assert.equal(records.size, 1, 'The controlled server accepted the first request before its timeout.');
  assert.equal(commitCount, 1);
  const originalReceipt = records.get(idempotencyKey).receipt;
  const receipt = await api.submitEnquiry(body, { idempotencyKey, bearerToken, timeoutMs: 2000 });

  assert.deepEqual(receipt, originalReceipt);
  assert.equal(commitCount, 1, 'Manual retry must reuse the controlled server receipt, not create a second enquiry.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, '/v1/enquiries');
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].key, requests[0].key);
  assert.equal(requests[1].body, requests[0].body);
  assert.equal(requests[1].authorization, `Bearer ${bearerToken}`);
});
