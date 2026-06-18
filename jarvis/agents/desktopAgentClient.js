const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const readline = require('readline');
const { normalizePlanEvent } = require('./planNormalizer');

const ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'agent_runtime', 'server.py');

function defaultPythonPath() {
  const venvPython = process.platform === 'win32'
    ? path.join(ROOT, 'agent_runtime', '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, 'agent_runtime', '.venv', 'bin', 'python');

  return fs.existsSync(venvPython) ? venvPython : 'python';
}

function createTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

class DesktopAgentClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pythonPath = options.pythonPath || defaultPythonPath();
    this.serverPath = options.serverPath || SERVER_PATH;
    this.root = options.root || ROOT;
    this.spawnImpl = options.spawn || spawn;
    this.toolExecutor = options.toolExecutor || null;
    this.child = null;
    this.readline = null;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
    this.stderrBuffer = [];
    this.pendingToolConfirmations = new Map();
  }

  isRunning() {
    return !!(this.child && !this.child.killed);
  }

  start() {
    if (this.isRunning()) return;

    this.child = this.spawnImpl(this.pythonPath, [this.serverPath], {
      cwd: this.root,
      env: {
        ...process.env,
        PYTHONPATH: this.root,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.readline = readline.createInterface({ input: this.child.stdout });
    this.readline.on('line', (line) => this.handleLine(line));
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      this.stderrBuffer.push(text);
      this.emit('stderr', text);
    });
    this.child.on('exit', (code, signal) => {
      this.ready = false;
      this.emit('exit', { code, signal });
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Desktop agent exited before response (${code ?? signal ?? 'unknown'})`));
      }
      this.pending.clear();
    });
    this.child.on('error', (error) => {
      this.emit('error', error);
    });
  }

  stop() {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.ready = false;
  }

  waitUntilReady(timeoutMs = 5000) {
    if (this.ready) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for Desktop Agent runtime'));
      }, timeoutMs);

      const onReady = () => {
        cleanup();
        resolve();
      };
      const onExit = ({ code, signal }) => {
        cleanup();
        reject(new Error(`Desktop Agent runtime exited before ready (${code ?? signal ?? 'unknown'})`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off('ready', onReady);
        this.off('exit', onExit);
      };

      this.on('ready', onReady);
      this.on('exit', onExit);
    });
  }

  send(type, payload = {}, options = {}) {
    if (!this.isRunning()) {
      throw new Error('Desktop Agent runtime is not running');
    }

    const id = options.id || `msg-${this.nextId++}`;
    const message = {
      type,
      id,
      payload,
    };
    if (options.taskId) message.task_id = options.taskId;

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return id;
  }

  ping(timeoutMs = 5000) {
    return this.request('ping', {}, { timeoutMs, terminalTypes: ['pong'] });
  }

  startTask(userCommand, options = {}) {
    const taskId = options.taskId || createTaskId();
    const id = this.send('start_task', { user_command: userCommand }, { taskId });
    return { id, taskId };
  }

  request(type, payload = {}, options = {}) {
    const terminalTypes = new Set(options.terminalTypes || ['final_report', 'needs_input', 'error']);
    const id = this.send(type, payload, options);

    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs || 5000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${type} response`));
      }, timeoutMs);

      this.pending.set(id, {
        terminalTypes,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  handleLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this.emit('protocol-error', { error, line });
      return;
    }

    if (event.type === 'plan_draft') {
      event = normalizePlanEvent(event);
    }

    if (event.type === 'ready') {
      this.ready = true;
      this.emit('ready', event);
    }

    if (event.type === 'tool_request') {
      this.handleToolRequest(event);
    }

    this.emit('event', event);
    if (event.task_id) {
      this.emit(`task:${event.task_id}`, event);
    }

    const pending = event.id ? this.pending.get(event.id) : null;
    if (pending && pending.terminalTypes.has(event.type)) {
      this.pending.delete(event.id);
      if (event.type === 'error') {
        pending.reject(new Error(event.payload && event.payload.error ? event.payload.error : 'Desktop Agent error'));
      } else {
        pending.resolve(event);
      }
    }
  }

  async handleToolRequest(event) {
    if (typeof this.toolExecutor !== 'function') return;

    const payload = event.payload || {};
    const requestId = payload.request_id || payload.requestId || '';
    const taskId = event.task_id || '';
    const request = {
      requestId,
      action: payload.action,
      policy: payload.policy,
      args: payload.args || {},
      taskId,
    };

    try {
      const result = await this.toolExecutor(request, {});
      if (result && (result.requiresConfirmation || result.requiresStrongConfirmation)) {
        this.pendingToolConfirmations.set(taskId, { request, result });
        const confirmationEvent = {
          type: 'needs_confirmation',
          task_id: taskId,
          payload: {
            phase: 'needs_confirmation',
            request,
            result,
            message: result.message || 'Confirmation is required.',
          },
        };
        this.emit('event', confirmationEvent);
        if (taskId) this.emit(`task:${taskId}`, confirmationEvent);
        return;
      }

      this.send('tool_result', { request_id: requestId, result }, { taskId });
    } catch (error) {
      this.send('tool_result', {
        request_id: requestId,
        result: { ok: false, error: error.message },
      }, { taskId });
    }
  }

  async confirmPendingTool(taskId, options = {}) {
    const pending = this.pendingToolConfirmations.get(taskId);
    if (!pending) {
      return { ok: false, error: 'No pending tool confirmation for task.' };
    }

    const executionOptions = pending.result.requiresStrongConfirmation
      ? { strongConfirmed: !!options.strongConfirmed }
      : { confirmed: true };

    if (pending.result.requiresStrongConfirmation && !executionOptions.strongConfirmed) {
      return { ok: false, error: 'Strong confirmation is required.' };
    }

    const result = await this.toolExecutor(pending.request, executionOptions);
    this.pendingToolConfirmations.delete(taskId);
    this.send('tool_result', {
      request_id: pending.request.requestId,
      result,
    }, { taskId });
    return { ok: true, result };
  }

  rejectPendingTool(taskId, reason = 'Tool request rejected by user.') {
    const pending = this.pendingToolConfirmations.get(taskId);
    if (!pending) {
      return { ok: false, error: 'No pending tool confirmation for task.' };
    }

    this.pendingToolConfirmations.delete(taskId);
    this.send('tool_result', {
      request_id: pending.request.requestId,
      result: { ok: false, cancelled: true, error: reason },
    }, { taskId });
    return { ok: true };
  }
}

module.exports = {
  DesktopAgentClient,
  defaultPythonPath,
  createTaskId,
};
