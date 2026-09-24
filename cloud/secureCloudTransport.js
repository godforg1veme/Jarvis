const https = require('node:https');
const net = require('node:net');
const { Agent, WebSocket, fetch } = require('undici');

const DEFAULT_DOH_ENDPOINT = 'https://dns.google/resolve';
const DEFAULT_CACHE_TTL_MS = 300000;
const MAX_CACHE_TTL_MS = 600000;

function isPublicIpv4(value) {
  if (net.isIP(value) !== 4) return false;
  const [first, second] = value.split('.').map(Number);
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  return true;
}

function parsePublicDnsAnswers(payload) {
  const answers = Array.isArray(payload && payload.Answer) ? payload.Answer : [];
  return answers
    .filter((answer) => answer && Number(answer.type) === 1 && isPublicIpv4(String(answer.data || '')))
    .map((answer) => ({
      address: String(answer.data),
      family: 4,
      ttlMs: Math.max(1000, Math.min(Number(answer.TTL || 0) * 1000 || DEFAULT_CACHE_TTL_MS, MAX_CACHE_TTL_MS)),
    }));
}

function requestDnsJson(endpoint, hostname, timeoutMs = 5000) {
  const url = new URL(endpoint);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', 'A');

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { accept: 'application/dns-json' },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error('Secure DNS lookup failed.'));
        try {
          const parsed = JSON.parse(body);
          if (Number(parsed.Status) !== 0) return reject(new Error('Secure DNS lookup failed.'));
          resolve(parsed);
        } catch (_) {
          reject(new Error('Secure DNS lookup failed.'));
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Secure DNS lookup timed out.')));
    request.once('error', () => reject(new Error('Secure DNS lookup failed.')));
  });
}

function createSecureDnsLookup(options = {}) {
  const endpoint = options.endpoint || DEFAULT_DOH_ENDPOINT;
  const request = options.request || requestDnsJson;
  const cache = new Map();

  async function resolve(hostname) {
    const key = String(hostname || '').trim().toLowerCase();
    if (!key) throw new Error('Secure DNS lookup failed.');
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.records;

    const records = parsePublicDnsAnswers(await request(endpoint, key));
    if (records.length === 0) throw new Error('Secure DNS returned no public IPv4 address.');
    cache.set(key, {
      records,
      expiresAt: Date.now() + Math.min(...records.map((record) => record.ttlMs)),
    });
    return records;
  }

  return (hostname, lookupOptions, callback) => {
    resolve(hostname).then((records) => {
      if (lookupOptions && lookupOptions.all) {
        callback(null, records.map(({ address, family }) => ({ address, family })));
        return;
      }
      callback(null, records[0].address, records[0].family);
    }).catch((error) => {
      error.code = 'EAI_AGAIN';
      callback(error);
    });
  };
}

function createSecureCloudTransport(options = {}) {
  const lookup = options.lookup || createSecureDnsLookup(options);
  const dispatcher = new Agent({
    connect: {
      lookup,
      timeout: Number(options.connectTimeoutMs || 10000),
    },
  });

  class SecureCloudWebSocket extends WebSocket {
    constructor(url) {
      super(url, { dispatcher });
    }
  }

  return {
    fetch: (input, init) => fetch(input, { ...(init || {}), dispatcher }),
    WebSocket: SecureCloudWebSocket,
    close: () => dispatcher.close(),
  };
}

module.exports = {
  DEFAULT_DOH_ENDPOINT,
  createSecureCloudTransport,
  createSecureDnsLookup,
  isPublicIpv4,
  parsePublicDnsAnswers,
  requestDnsJson,
};
