const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { toFileCandidate } = require('./fileSafety');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_IPC_TIMEOUT_MS = 1000;
const DEFAULT_PROCESS_TIMEOUT_MS = 7000;
const DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024;

function executableCandidates(name, options = {}) {
  const env = options.env || process.env;
  const explicit = name === 'es.exe'
    ? options.esPath || env.EVERYTHING_ES_PATH
    : options.everythingPath || env.EVERYTHING_EXE_PATH;
  const candidates = [];
  if (explicit) candidates.push(explicit);

  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir.replace(/^"|"$/g, ''), name));
  }

  if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Everything', name));

  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  for (const root of programFiles) candidates.push(path.join(root, 'Everything', name));

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function findExecutable(name, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  return executableCandidates(name, options).find((candidate) => {
    try {
      return existsSync(candidate);
    } catch {
      return false;
    }
  }) || '';
}

function quoteSearchText(value) {
  const text = String(value || '').trim().replace(/^['"«»]+|['"«»]+$/g, '');
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeEverythingRegex(value) {
  return String(value || '')
    .trim()
    .replace(/^['"«»]+|['"«»]+$/g, '')
    .replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    .replace(/ /g, '\\x20');
}

function buildSearchExpression(args = {}) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Everything query is required');

  const typePrefix = args.targetType === 'file'
    ? 'file:'
    : args.targetType === 'directory'
      ? 'folder:'
      : '';
  const escaped = escapeEverythingRegex(query);
  const pattern = args.exact === false ? escaped : `^${escaped}$`;
  return `${typePrefix}regex:${pattern}`;
}

function buildEsArgs(args = {}) {
  const maxResults = Math.min(Math.max(Number(args.maxResults || 60), 1), 1000);
  const timeoutMs = Math.min(Math.max(Number(args.ipcTimeoutMs || DEFAULT_IPC_TIMEOUT_MS), 250), 30000);
  const result = [
    '-csv',
    '-full-path-and-name',
    '-size',
    '-date-modified',
    '-attributes',
    '-date-format', '3',
    '-size-format', '1',
    '-no-digit-grouping',
    '-n', String(maxResults),
    '-timeout', String(timeoutMs),
  ];

  if (args.locationPath) {
    const locationPath = String(args.locationPath);
    if (!isAbsoluteLocalPath(locationPath)) throw new Error('Everything location must be an absolute local path');
    result.push('-path', locationPath);
  }

  result.push(buildSearchExpression(args));
  return result;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('Malformed Everything CSV output');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function isAbsoluteLocalPath(value) {
  const text = String(value || '');
  return /^[a-zA-Z]:\\/.test(text) && path.win32.isAbsolute(text) && !text.startsWith('\\\\');
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function parseEverythingCsv(text, options = {}) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map(normalizeHeader);
  const pathIndex = header.findIndex((name) => ['filename', 'fullpathandname'].includes(name));
  const sizeIndex = header.indexOf('size');
  const modifiedIndex = header.findIndex((name) => ['datemodified', 'modified'].includes(name));
  const attributesIndex = header.findIndex((name) => ['attributes', 'attribs'].includes(name));
  if (pathIndex < 0) throw new Error('Everything CSV is missing the filename column');

  const maxResults = options.maxResults || 1000;
  const candidates = [];
  for (const row of rows.slice(1)) {
    const rawPath = row[pathIndex];
    if (!isAbsoluteLocalPath(rawPath)) continue;
    const root = path.win32.parse(rawPath).root;
    const fullPath = rawPath.length > root.length ? rawPath.replace(/[\\/]+$/, '') : rawPath;
    const attributes = attributesIndex >= 0 ? String(row[attributesIndex] || '') : '';
    const numericAttributes = /^\d+$/.test(attributes) ? Number(attributes) : 0;
    const directory = attributes.toUpperCase().includes('D') || (numericAttributes & 0x10) === 0x10;
    const size = sizeIndex >= 0 ? Number(row[sizeIndex] || 0) : 0;
    const modifiedAt = modifiedIndex >= 0 && row[modifiedIndex] ? row[modifiedIndex] : '';
    const stats = {
      isDirectory: () => directory,
      isFile: () => !directory,
      size: Number.isFinite(size) ? size : 0,
      mtime: modifiedAt ? new Date(modifiedAt) : new Date(0),
    };
    const candidate = toFileCandidate(fullPath, stats, 'everything', 0);
    if (!modifiedAt || Number.isNaN(stats.mtime.getTime())) candidate.modifiedAt = '';
    candidates.push(candidate);
    if (candidates.length >= maxResults) break;
  }
  return candidates;
}

function normalizeForEncodingMatch(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function scoreLegacyDecoding(text, options = {}) {
  let score = 0;
  if (!text.includes('\uFFFD')) score += 10;
  if (/^Filename(?:,|\r?$)/mi.test(text)) score += 30;
  if (/[a-z]:\\/i.test(text)) score += 20;
  if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) score += 10;
  score -= (text.match(/[\u2500-\u257F]/g) || []).length * 5;

  const query = normalizeForEncodingMatch(options.query);
  if (query && normalizeForEncodingMatch(text).includes(query)) score += 100;
  return score;
}

function decodeEsBuffer(value, options = {}) {
  if (typeof value === 'string') return value;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (buffer.length === 0) return '';

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    // ES uses the active Windows console code page when stdout is redirected.
  }

  const candidates = ['ibm866', 'windows-1251'].map((encoding, index) => {
    const text = new TextDecoder(encoding).decode(buffer);
    return { text, score: scoreLegacyDecoding(text, options), index };
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0].text.replace(/^\uFEFF/, '');
}

function defaultExecFile(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      windowsHide: true,
      encoding: 'buffer',
      timeout: options.processTimeoutMs || DEFAULT_PROCESS_TIMEOUT_MS,
      maxBuffer: options.maxOutputBytes || DEFAULT_MAX_OUTPUT,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? Number(error.code) || -1 : 0,
        stdout: stdout || Buffer.alloc(0),
        stderr: stderr || Buffer.from((error && error.message) || '', 'utf8'),
        error,
      });
    });
  });
}

function defaultStartEverything(executable) {
  const child = spawn(executable, ['-startup'], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runEs(esPath, args, options = {}) {
  const run = options.execFile || defaultExecFile;
  const response = await run(esPath, args, {
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    processTimeoutMs: options.processTimeoutMs || DEFAULT_PROCESS_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes || DEFAULT_MAX_OUTPUT,
  });
  return {
    ...response,
    stdout: decodeEsBuffer(response.stdout, { query: options.decodeQuery }),
    stderr: decodeEsBuffer(response.stderr, { query: options.decodeQuery }),
  };
}

async function waitForIpc(esPath, options = {}) {
  const wait = options.delay || delay;
  const deadline = Date.now() + (options.startupTimeoutMs || DEFAULT_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const probe = await runEs(esPath, ['-n', '1', '-timeout', '250', 'file:'], options);
    if (probe.ok) return true;
    if (probe.code !== 8) return false;
    await wait(Math.min(options.retryDelayMs || 250, Math.max(deadline - Date.now(), 0)));
  }
  return false;
}

async function searchEverything(args = {}, options = {}) {
  const esPath = findExecutable('es.exe', options);
  if (!esPath) return { ok: false, reason: 'everything_cli_missing', results: [] };

  let esArgs;
  try {
    esArgs = buildEsArgs(args);
  } catch (error) {
    return { ok: false, reason: 'invalid_everything_query', error: error.message, results: [] };
  }

  let response = await runEs(esPath, esArgs, { ...options, decodeQuery: args.query });
  if (!response.ok && response.code === 8) {
    const everythingPath = findExecutable('Everything.exe', options);
    if (!everythingPath) return { ok: false, reason: 'everything_app_missing', results: [] };
    try {
      const startEverything = options.startEverything || defaultStartEverything;
      await startEverything(everythingPath);
    } catch (error) {
      return { ok: false, reason: 'everything_start_failed', error: error.message, results: [] };
    }
    const ready = await waitForIpc(esPath, options);
    if (!ready) return { ok: false, reason: 'everything_ipc_unavailable', results: [] };
    response = await runEs(esPath, esArgs, { ...options, decodeQuery: args.query });
  }

  if (!response.ok) {
    const reason = response.code === 8 ? 'everything_ipc_unavailable' : 'everything_query_failed';
    return { ok: false, reason, code: response.code, error: response.stderr, results: [] };
  }

  try {
    return {
      ok: true,
      provider: 'everything',
      results: parseEverythingCsv(response.stdout, { maxResults: args.maxResults || 1000 }),
    };
  } catch (error) {
    return { ok: false, reason: 'everything_output_invalid', error: error.message, results: [] };
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_IPC_TIMEOUT_MS,
  DEFAULT_PROCESS_TIMEOUT_MS,
  executableCandidates,
  findExecutable,
  quoteSearchText,
  escapeEverythingRegex,
  buildSearchExpression,
  buildEsArgs,
  parseCsv,
  parseEverythingCsv,
  scoreLegacyDecoding,
  decodeEsBuffer,
  isAbsoluteLocalPath,
  searchEverything,
};
