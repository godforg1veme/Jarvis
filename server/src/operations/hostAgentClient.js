const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const { validateRequest, validateResponse } = require('./hostAgentProtocol');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestMac(authenticator, request) {
  return crypto.createHmac('sha256', authenticator).update(canonicalJson(request), 'utf8').digest('hex');
}

class HostAgentClient {
  constructor(options = {}) {
    this.socketPath = options.socketPath;
    this.authenticatorPath = options.authenticatorPath;
    this.timeoutMs = Math.min(Math.max(Number(options.timeoutMs || 15000), 1000), 60000);
    this.connect = options.connect || net.createConnection;
    this.readFile = options.readFile || fs.readFileSync;
  }

  authenticator() {
    const value = this.readFile(this.authenticatorPath, 'utf8').trim();
    if (value.length < 32 || value.length > 512) throw new Error('Host Agent authenticator is invalid');
    return value;
  }

  async request(value) {
    const request = validateRequest(value);
    const auth = this.authenticator();
    return new Promise((resolve, reject) => {
      let data = '';
      let settled = false;
      const finish = (callback, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(result);
      };
      const socket = this.connect({ path: this.socketPath });
      const timer = setTimeout(() => {
        socket.destroy();
        const error = new Error('Host Agent request timed out');
        error.code = 'HOST_AGENT_TIMEOUT';
        finish(reject, error);
      }, this.timeoutMs);
      socket.setEncoding('utf8');
      socket.once('error', (error) => finish(reject, error));
      socket.on('data', (chunk) => {
        data += chunk;
        if (Buffer.byteLength(data, 'utf8') > 64 * 1024) {
          socket.destroy();
          finish(reject, new Error('Host Agent response is too large'));
        }
      });
      socket.once('end', () => {
        try {
          finish(resolve, validateResponse(JSON.parse(data.trim()), request));
        } catch (error) {
          finish(reject, error);
        }
      });
      socket.once('connect', () => socket.end(`${JSON.stringify({ auth: requestMac(auth, request), request })}\n`));
    });
  }
}

module.exports = { HostAgentClient, canonicalJson, requestMac };
