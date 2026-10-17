// Leave headroom within the server container's default Docker stop grace.
const DEFAULT_SHUTDOWN_MS = 8000;

// Install once in a worker constructor. Existing callers may ignore stop()'s
// return value: admission and timers still stop synchronously. Shutdown callers
// can await it to keep the shared database open for already admitted work.
function trackWorker(worker, taskName) {
  const task = worker[taskName];
  const start = worker.start;
  const stop = worker.stop;
  const pending = new Set();
  let stopped = false;
  let draining = null;
  worker[taskName] = function (...args) {
    if (stopped) return Promise.resolve();
    let result;
    try { result = Promise.resolve(task.apply(this, args)); }
    catch (error) { result = Promise.reject(error); }
    pending.add(result);
    result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  };
  worker.start = function (...args) {
    if (stopped && pending.size) return;
    stopped = false;
    draining = null;
    return start.apply(this, args);
  };
  worker.stop = function (...args) {
    if (draining) return draining;
    stopped = true;
    let stoppedResult;
    try { stoppedResult = stop.apply(this, args); }
    catch (error) { stoppedResult = Promise.reject(error); }
    draining = Promise.allSettled([stoppedResult, ...pending]).then((results) => {
      if (results.some((result) => result.status === 'rejected')) {
        throw Object.assign(new Error('WORKER_DRAIN_FAILED'), { code: 'WORKER_DRAIN_FAILED' });
      }
    });
    // Legacy stop callers do not await; still let awaiting callers see failure.
    draining.catch(() => {});
    return draining;
  };
}

function shutdownBudget(value) {
  return Math.min(Math.max(Number(value) || DEFAULT_SHUTDOWN_MS, 1), 30000);
}

// All admission/timer stops begin synchronously, before waiting for any drain.
// The pool is a separate final phase; it must not race the normal worker drain.
function createResourceCloser(resources, { final = [], timeoutMs } = {}) {
  let closing;
  return function close(options = {}) {
    if (closing) return closing;
    const ownDeadline = Date.now() + shutdownBudget(timeoutMs);
    const deadline = Number.isFinite(options.deadline) ? Math.min(options.deadline, ownDeadline) : ownDeadline;
    const failures = [];
    function begin({ name, close: closeResource }) {
      let result;
      try { result = closeResource(deadline); }
      catch (_) { result = Promise.reject(); }
      const outcome = Promise.resolve(result).then(
        () => null,
        () => ({ resource: name, code: 'RESOURCE_CLOSE_FAILED' }),
      );
      return { name, outcome };
    }
    async function wait({ name, outcome }) {
      let timer;
      const remaining = Math.max(0, deadline - Date.now());
      try {
        const failure = await Promise.race([
          outcome,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve({ resource: name, code: 'RESOURCE_CLOSE_TIMEOUT' }), remaining);
          }),
        ]);
        if (failure) failures.push(failure);
      } finally { clearTimeout(timer); }
    }
    const initial = resources.map(begin);
    closing = (async () => {
      await Promise.all(initial.map(wait));
      for (const resource of final) await wait(begin(resource));
      if (failures.length) {
        const error = new Error('RUNTIME_CLOSE_FAILED');
        error.code = 'RUNTIME_CLOSE_FAILED';
        error.failures = failures;
        throw error;
      }
    })();
    return closing;
  };
}

module.exports = { createResourceCloser, trackWorker };
