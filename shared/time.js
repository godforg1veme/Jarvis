// Display policy: fixed UTC+03:00, including historical dates. Storage stays UTC.
const MOSCOW_TIME_ZONE = 'Etc/GMT-3';
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function formatMoscowDateTime(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return `${date.toLocaleString('ru-RU', { timeZone: MOSCOW_TIME_ZONE, hourCycle: 'h23' })} МСК`;
}

function moscowIso(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
  return new Date(date.getTime() + MOSCOW_OFFSET_MS).toISOString().replace(/Z$/, '+03:00');
}

function parseMoscowInput(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid date');
  const source = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(source);
  const local = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(source);
  if (!iso && !local) throw new Error('Invalid date');
  const [year, month, day, hour, minute, second] = iso
    ? iso.slice(1, 7).map((v) => Number(v || 0))
    : [local[3], local[2], local[1], local[4], local[5], local[6] || 0].map(Number);
  const millisecond = iso?.[7] ? Number(iso[7].padEnd(3, '0')) : 0;
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59)
    throw new Error('Invalid date');
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day)
    throw new Error('Invalid date');
  let offset = MOSCOW_OFFSET_MS;
  if (iso?.[8]) {
    const zone = iso[8];
    if (zone.toUpperCase() === 'Z') offset = 0;
    else {
      const digits = zone.slice(1).replace(':', '');
      const h = Number(digits.slice(0, 2)), m = Number(digits.slice(2));
      if (h > 14 || m > 59 || h === 14 && m !== 0) throw new Error('Invalid date');
      offset = (h * 60 + m) * 60000 * (zone[0] === '+' ? 1 : -1);
    }
  }
  return new Date(calendar.getTime() - offset).toISOString();
}

module.exports = { MOSCOW_TIME_ZONE, MOSCOW_OFFSET_MS, formatMoscowDateTime, moscowIso, parseMoscowInput };
