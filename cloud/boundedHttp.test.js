const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedJsonFetch } = require('./boundedHttp');

test('bounds streamed body with no content length before buffering beyond limit', async () => {
  let cancelled = false;
  const response = { headers: new Headers(), body: new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  }) };
  await assert.rejects(boundedJsonFetch(async () => response, 'https://example.test', {}, { maxBytes: 10 }), /HTTP_RESPONSE_TOO_LARGE/);
  assert.equal(cancelled, true);
});

test('deadline covers stalled headers even when fetch ignores signal', async () => {
  let signal;
  await assert.rejects(boundedJsonFetch(async (_url, options) => { signal = options.signal; return new Promise(() => {}); },
    'https://example.test', {}, { timeoutMs: 15 }), /HTTP_DEADLINE_EXCEEDED/);
  assert.equal(signal.aborted, true);
});

test('deadline covers stalled body and cancels reader', async () => {
  let cancelled = false;
  const response = { headers: new Headers(), body: new ReadableStream({ cancel() { cancelled = true; } }) };
  await assert.rejects(boundedJsonFetch(async () => response, 'https://example.test', {}, { timeoutMs: 15 }), /HTTP_DEADLINE_EXCEEDED/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('caller cancellation reaches fetch and terminates pending request', async () => {
  const caller = new AbortController();
  let signal;
  const request = boundedJsonFetch(async (_url, options) => { signal = options.signal; return new Promise(() => {}); },
    'https://example.test', { signal: caller.signal });
  caller.abort(new Error('caller stopped'));
  await assert.rejects(request, /caller stopped/);
  assert.equal(signal.aborted, true);
});

test('declared oversized response cancels without reading and cancellation rejection is handled', async () => {
  let cancelled = 0;
  await assert.rejects(boundedJsonFetch(async () => ({ headers: new Headers({ 'content-length': '100' }),
    body: { cancel() { cancelled += 1; return Promise.reject(new Error('cancel rejected')); } },
  }), 'https://example.test', {}, { maxBytes: 10 }), /HTTP_RESPONSE_TOO_LARGE/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test('late response after header deadline is cancelled rather than leaked', async () => {
  let respond;
  let cancelled = false;
  const operation = boundedJsonFetch(() => new Promise((resolve) => { respond = resolve; }),
    'https://example.test', {}, { timeoutMs: 10 });
  await assert.rejects(operation, /HTTP_DEADLINE_EXCEEDED/);
  respond({ body: { cancel() { cancelled = true; } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});
