const crypto = require('node:crypto');
const { evidenceEventSchema } = require('./contracts');

const SOURCES = new Set(['xray', 'hysteria2', 'host-agent', 'systemd', 'probe']);
const MAX_EVENTS = 40;
const MAX_TOTAL_BYTES = 8 * 1024;

const SECRET_PATTERNS = [
  /\b(?:vless|hy2|hysteria2):\/\/\S+/giu,
  /\bhttps?:\/\/[^\s/:]+:[^\s@]+@\S+/giu,
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/gu,
  /\bBearer\s+\S+/giu,
  /\b(?:authorization|token|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|private[_ -]?key|uuid)\b["']?\s*[:=]\s*["']?(?:Bearer\s+)?[^\s,"'}]+/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu,
  /\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/giu,
  /\b[A-Za-z0-9_-]{40,}\b/gu,
];

function cleanMessage(value) {
  let result = String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\r\n\t]+/gu, ' ');
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, '[REDACTED]');
  return result.replace(/\s{2,}/gu, ' ').trim().slice(0, 240);
}

function sanitizeEvidence(input) {
  const grouped = new Map();
  let rejected = 0;
  for (const raw of Array.isArray(input) ? input.slice(0, 200) : []) {
    const source = String(raw?.source || '');
    const parsedAt = new Date(String(raw?.observedAt || ''));
    const message = cleanMessage(raw?.message);
    if (!SOURCES.has(source) || Number.isNaN(parsedAt.getTime()) || !message) { rejected += 1; continue; }
    const key = `${source}\0${message}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.repetitions = Math.min(existing.repetitions + 1, 1000);
      if (parsedAt > new Date(existing.observedAt)) existing.observedAt = parsedAt.toISOString();
    } else {
      grouped.set(key, { source, observedAt: parsedAt.toISOString(), message, repetitions: 1 });
    }
  }

  const sorted = [...grouped.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const evidence = [];
  let bytes = 0;
  let truncated = rejected > 0 || sorted.length > MAX_EVENTS || (Array.isArray(input) && input.length > 200);
  for (const candidate of sorted) {
    if (evidence.length >= MAX_EVENTS) { truncated = true; break; }
    const item = { id: `E${evidence.length + 1}`, ...candidate };
    const size = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (bytes + size > MAX_TOTAL_BYTES) { truncated = true; break; }
    evidence.push(evidenceEventSchema.parse(item));
    bytes += size;
  }
  return Object.freeze({ evidence: Object.freeze(evidence), truncated, digest: crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex') });
}

module.exports = { MAX_EVENTS, MAX_TOTAL_BYTES, cleanMessage, sanitizeEvidence };
