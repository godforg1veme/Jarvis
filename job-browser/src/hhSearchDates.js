const MOSCOW_OFFSET_MS = 3 * 3600000;

function hhDate(instant) {
  const time = Date.parse(instant);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time + MOSCOW_OFFSET_MS);
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
}

module.exports = { hhDate };
