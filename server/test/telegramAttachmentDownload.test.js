const assert = require('node:assert/strict');
const test = require('node:test');
const { downloadTelegramAttachment } = require('../src/telegram/bot');

const ctx = { async getFile() { return { file_path: 'documents/fixture.txt' }; } };
const safeFailure = (error) => error.message === 'Telegram document download failed' && !error.cause;

function streamedResponse(chunks, headers = {}) {
  const state = { reads: 0, cancelled: false, buffered: false };
  const response = new Response(new ReadableStream({
    pull(controller) {
      state.reads += 1;
      if (chunks.length) controller.enqueue(Buffer.from(chunks.shift()));
      else controller.close();
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 }), { headers });
  const original = response.arrayBuffer.bind(response);
  response.arrayBuffer = () => { state.buffered = true; return original(); };
  return { response, state };
}

for (const length of [null, '1', 'invalid']) {
  test(`attachment rejects oversized chunked stream before buffering (length ${length})`, async () => {
    const { response, state } = streamedResponse(['123', '456', 'unread'], length === null ? {} : { 'content-length': length });
    await assert.rejects(downloadTelegramAttachment(ctx, 'fixture-token', 5, async () => response), safeFailure);
    assert.equal(state.buffered, false);
    assert.equal(state.reads, 2);
    assert.equal(state.cancelled, true);
  });
}

test('attachment accepts exact byte limit and checks bytes rather than characters', async () => {
  const { response, state } = streamedResponse(['я', 'а']);
  const data = await downloadTelegramAttachment(ctx, 'fixture-token', 4, async () => response);
  assert.equal(data.toString(), 'яа');
  assert.equal(data.length, 4);
  assert.equal(state.buffered, false);
});

test('oversized declared length is rejected and body cancelled without a read', async () => {
  const { response, state } = streamedResponse(['unread'], { 'content-length': '100' });
  await assert.rejects(downloadTelegramAttachment(ctx, 'fixture-token', 5, async () => response), safeFailure);
  assert.equal(state.reads, 0);
  assert.equal(state.cancelled, true);
});

async function withinTestDeadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('download failed to enforce its deadline')), 250);
    })]);
  } finally { clearTimeout(timer); }
}

for (const stage of ['metadata', 'fetch', 'read']) {
  test(`attachment deadline bounds a never-resolving ${stage}`, async () => {
    let metadataSignal;
    let fetchOptions;
    let cancelled = false;
    const never = () => new Promise(() => {});
    const context = { getFile(signal) {
      metadataSignal = signal;
      return stage === 'metadata' ? never() : ctx.getFile();
    } };
    const fetchImpl = async (_url, options) => {
      fetchOptions = options;
      if (stage === 'fetch') return never();
      return new Response(new ReadableStream({
        pull() { return never(); },
        cancel() { cancelled = true; return never(); },
      }));
    };
    await assert.rejects(withinTestDeadline(downloadTelegramAttachment(context, 'fixture-token', 5, fetchImpl, { timeoutMs: 20 })), safeFailure);
    assert.equal(metadataSignal.aborted, true);
    if (stage !== 'metadata') assert.equal(fetchOptions.signal, metadataSignal);
    if (stage === 'read') assert.equal(cancelled, true);
  });
}

test('attachment rejects redirects and transport exceptions without retaining private details', async () => {
  let options;
  await assert.rejects(downloadTelegramAttachment(ctx, 'fixture-token', 5, async (_url, supplied) => {
    options = supplied;
    return new Response('', { status: 302, headers: { location: 'https://example.test' } });
  }), safeFailure);
  assert.equal(options.redirect, 'error');
  await assert.rejects(downloadTelegramAttachment(ctx, 'fixture-token', 5, async () => {
    throw new Error('private transport details');
  }), safeFailure);
});

test('attachment cancels a response arriving after fetch deadline', async () => {
  const { response, state } = streamedResponse(['unread']);
  let resolveFetch;
  const pending = downloadTelegramAttachment(ctx, 'fixture-token', 5,
    () => new Promise((resolve) => { resolveFetch = resolve; }), { timeoutMs: 20 });
  await assert.rejects(withinTestDeadline(pending), safeFailure);
  resolveFetch(response);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.cancelled, true);
  assert.equal(state.reads, 0);
});

test('attachment rejects empty, missing and failed streams with fixed errors', async () => {
  for (const response of [
    new Response(null),
    new Response(''),
    new Response(new ReadableStream({ pull(controller) { controller.error(new Error('private stream diagnostic')); } })),
  ]) {
    await assert.rejects(downloadTelegramAttachment(ctx, 'fixture-token', 5, async () => response), safeFailure);
  }
});

test('attachment oversize on final chunk cancels even when cancellation rejects', async () => {
  let cancelled = false;
  const chunks = ['12345', '6'];
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(Buffer.from(chunks.shift())); },
    cancel() { cancelled = true; throw new Error('private cancellation diagnostic'); },
  }, { highWaterMark: 0 }));
  await assert.rejects(downloadTelegramAttachment(ctx, 'fixture-token', 5, async () => response), safeFailure);
  assert.equal(cancelled, true);
});
