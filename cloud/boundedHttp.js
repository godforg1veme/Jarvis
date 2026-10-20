const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function cancelQuietly(stream) {
  try { Promise.resolve(stream?.cancel()).catch(() => {}); } catch (_) {}
}

async function boundedJsonFetch(fetchImpl, url, options = {}, limits = {}) {
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid HTTP limits.');
  }
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  const onControllerAbort = () => rejectAbort(controller.signal.reason || new Error('HTTP_ABORTED'));
  controller.signal.addEventListener('abort', onControllerAbort, { once: true });
  const callerSignal = options.signal;
  const onAbort = () => controller.abort(callerSignal.reason);
  if (callerSignal?.aborted) onAbort();
  else callerSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('HTTP_DEADLINE_EXCEEDED')), timeoutMs);
  let reader;
  let response;
  try {
    if (controller.signal.aborted) throw controller.signal.reason || new Error('HTTP_ABORTED');
    const fetching = Promise.resolve(fetchImpl(url, { ...options, signal: controller.signal })).then((received) => {
      if (controller.signal.aborted) {
        cancelQuietly(received.body);
        throw controller.signal.reason || new Error('HTTP_ABORTED');
      }
      return received;
    });
    response = await Promise.race([fetching, aborted]);
    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > maxBytes) throw new Error('HTTP_RESPONSE_TOO_LARGE');
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error('HTTP_STREAM_REQUIRED');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      // Some injected fetches do not honor AbortSignal during a pending body read.
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error('HTTP_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(next.value));
    }
    const body = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    return { response, body };
  } catch (error) {
    controller.abort(error);
    if (!reader && response?.body) cancelQuietly(response.body);
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onControllerAbort);
    callerSignal?.removeEventListener('abort', onAbort);
    if (reader) { cancelQuietly(reader); try { reader.releaseLock(); } catch (_) {} }
  }
}

module.exports = { boundedJsonFetch, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES };
