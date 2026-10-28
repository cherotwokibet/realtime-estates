import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getEventListeners } from 'node:events';
import { photoRequest } from '../dist/tests/lib/photo-request.js';
test(
  'manual photo cancellation stops an actual held loopback request once and reports uncertain write outcome',
  { timeout: 10000 },
  async () => {
    let requests = 0,
      arrived,
      disconnected;
    const observed = new Promise((resolve) => {
        arrived = resolve;
      }),
      closed = new Promise((resolve) => {
        disconnected = resolve;
      });
    const server = createServer((request, response) => {
      requests++;
      request.resume();
      response.once('close', disconnected);
      arrived();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    try {
      const address = server.address(),
        pending = photoRequest(
          `http://127.0.0.1:${address.port}/synthetic-upload`,
          'synthetic-instance',
          'PUT',
          undefined,
          new File(['synthetic transport bytes'], 'fictional.png', { type: 'image/png' }),
          controller.signal,
        );
      await observed;
      controller.abort();
      await assert.rejects(pending, (error) => error.status === 0 && error.uncertain === true);
      await closed;
      assert.equal(requests, 1);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
test('an ignored cancellation followed by a committed response requires readback instead of adopting the late success', async () => {
  const previous = globalThis.fetch,
    controller = new AbortController();
  let reply,
    calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Promise((resolve) => {
      reply = resolve;
    });
  };
  try {
    const pending = photoRequest(
      '/synthetic-upload',
      'instance',
      'PUT',
      undefined,
      new File(['bytes'], 'fictional.png', { type: 'image/png' }),
      controller.signal,
    );
    controller.abort();
    reply(Response.json({ state: 'verified' }));
    await assert.rejects(pending, (error) => error.status === 0 && error.uncertain === true);
    assert.equal(calls, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally {
    globalThis.fetch = previous;
  }
});
test('completed requests remove their cancellation listener and do not start work when later aborted', async () => {
  const previous = globalThis.fetch,
    controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    return Response.json({ original: 'known' });
  };
  try {
    assert.deepEqual(
      await photoRequest(
        '/synthetic-read',
        'instance',
        'GET',
        undefined,
        undefined,
        controller.signal,
      ),
      { original: 'known' },
    );
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    controller.abort();
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
test('already cancelled reads never dispatch and remain read failures without a write uncertainty claim', async () => {
  const previous = globalThis.fetch,
    controller = new AbortController();
  controller.abort();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error('Unexpected request');
  };
  try {
    await assert.rejects(
      photoRequest('/synthetic-read', 'instance', 'GET', undefined, undefined, controller.signal),
      (error) => error.status === 0 && error.uncertain === false,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
  }
});
