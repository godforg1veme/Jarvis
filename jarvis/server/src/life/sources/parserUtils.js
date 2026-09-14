const { createHash } = require('node:crypto');

function text(value, max, label) { const result = String(value || '').trim(); if (!result || result.length > max) throw new Error(`${label} is invalid`); return result; }
function optionalText(value, max) { if (value == null || value === '') return null; return text(value, max, 'text'); }
function timestamp(value, label = 'timestamp') { const date = new Date(value); if (!value || Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`); return date.toISOString(); }
function timezone(value) { const result = text(value, 80, 'timezone'); try { new Intl.DateTimeFormat('en-US', { timeZone: result }).format(new Date(0)); } catch { throw new Error('timezone is invalid'); } return result; }
function amount(value) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 1000000000) throw new Error('amount is invalid'); return number; }
function currency(value) { const result = text(value, 3, 'currency').toUpperCase(); if (!/^[A-Z]{3}$/.test(result)) throw new Error('currency is invalid'); return result; }
function hashRef(value) { return createHash('sha256').update(text(value, 256, 'reference')).digest('hex').slice(0, 32); }
function list(value, max, map) { if (!Array.isArray(value) || value.length > max) throw new Error('list is invalid'); return value.map(map); }
function result(type, externalRef, occurredAt, summary, structuredData) { return { externalRef: text(externalRef, 256, 'external reference'), occurredAt: timestamp(occurredAt), summary: text(summary, 1000, 'summary'), structuredData: { sourceType: type, ...structuredData }, confidence: 1 }; }

module.exports = { amount, currency, hashRef, list, optionalText, result, text, timestamp, timezone };
