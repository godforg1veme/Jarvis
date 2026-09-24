const { normalizedLower } = require('./textNormalizer');

const RU_MONTHS = Object.freeze({
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
});
const EN_MONTHS = Object.freeze({
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
});
const WEEKDAYS = Object.freeze({
  воскресенье: 0, воскресенья: 0, понедельник: 1, понедельника: 1,
  вторник: 2, вторника: 2, среда: 3, среду: 3, четверг: 4, четверга: 4,
  пятница: 5, пятницу: 5, суббота: 6, субботу: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
});
const DAY_PARTS = Object.freeze({
  morning: [8, 12], утром: [8, 12],
  afternoon: [12, 17], 'днём': [12, 17], днем: [12, 17],
  evening: [18, 22], вечером: [18, 22],
});

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const result = {};
  for (const part of parts) if (part.type !== 'literal') result[part.type] = Number(part.value);
  return result;
}

function zonedDate({ year, month, day, hour = 0, minute = 0 }, timezone) {
  let timestamp = Date.UTC(year, month, day, hour, minute, 0, 0);
  const desired = Date.UTC(year, month, day, hour, minute, 0, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(timestamp), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second || 0, 0);
    timestamp += desired - represented;
  }
  return new Date(timestamp);
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

function parseClock(text) {
  const match = text.match(/(?:(?<![\p{L}\p{N}_])(?:в|at)\s*)([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?|(?<![\p{L}\p{N}_])(1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm)(?![\p{L}\p{N}_])/iu);
  if (!match) return null;
  let hour = Number(match[1] ?? match[4]);
  const marker = (match[3] || match[6] || '').toLowerCase();
  if (marker === 'pm' && hour < 12) hour += 12;
  if (marker === 'am' && hour === 12) hour = 0;
  return { hour, minute: Number(match[2] ?? match[5] ?? 0) };
}

function parseDateParts(text, nowParts) {
  if (/(?<![\p{L}\p{N}_])(?:послезавтра|day after tomorrow)(?![\p{L}\p{N}_])/iu.test(text)) return addLocalDays(nowParts, 2);
  if (/(?<![\p{L}\p{N}_])(?:завтра|tomorrow)(?![\p{L}\p{N}_])/iu.test(text)) return addLocalDays(nowParts, 1);
  if (/(?<![\p{L}\p{N}_])(?:сегодня|today)(?![\p{L}\p{N}_])/iu.test(text)) return addLocalDays(nowParts, 0);
  const inDays = text.match(/(?<![\p{L}\p{N}_])(?:через|in)\s+(\d{1,3})\s+(?:д(?:ень|ня|ней)|days?)(?![\p{L}\p{N}_])/iu);
  if (inDays) return addLocalDays(nowParts, Math.min(Number(inDays[1]), 365));
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) - 1, day: Number(iso[3]) };
  const numeric = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?\b/u);
  if (numeric) return { year: Number(numeric[3] || nowParts.year), month: Number(numeric[2]) - 1, day: Number(numeric[1]) };
  const words = text.match(/(?<![\p{L}\p{N}_])(\d{1,2})\s+([\p{L}]+)(?:\s+(20\d{2}))?(?![\p{L}\p{N}_])/iu);
  if (words) {
    const month = RU_MONTHS[words[2]] ?? EN_MONTHS[words[2]];
    if (month !== undefined) return { year: Number(words[3] || nowParts.year), month, day: Number(words[1]) };
  }
  const english = text.match(/(?<![\p{L}\p{N}_])([a-z]+)\s+(\d{1,2})(?:,?\s+(20\d{2}))?(?![\p{L}\p{N}_])/iu);
  if (english && EN_MONTHS[english[1]] !== undefined) return { year: Number(english[3] || nowParts.year), month: EN_MONTHS[english[1]], day: Number(english[2]) };
  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (!new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, 'iu').test(text)) continue;
    let delta = (weekday - new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay() + 7) % 7;
    if (delta === 0 || /(?:следующ\p{L}*|(?<![\p{L}\p{N}_])next(?![\p{L}\p{N}_]))/iu.test(text)) delta += 7;
    return addLocalDays(nowParts, delta);
  }
  return null;
}

function parseTemporal(text, options = {}) {
  const timezone = String(options.timezone || 'UTC');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const source = normalizedLower(text, options.locale || 'ru-RU');
  const nowParts = zonedParts(now, timezone);
  const dateParts = parseDateParts(source, nowParts);
  if (!dateParts) return { dueAt: null, dueWindowEndAt: null, precision: 'none', timezone, confidence: 0.7 };
  const range = source.match(/(?<![\p{L}\p{N}_])(?:с|between)\s+(\d{1,2})(?::(\d{2}))?\s+(?:до|and)\s+(\d{1,2})(?::(\d{2}))?\s*(pm|am)?/iu);
  if (range) {
    let startHour = Number(range[1]); let endHour = Number(range[3]);
    if (range[5]?.toLowerCase() === 'pm') { if (startHour < 12) startHour += 12; if (endHour < 12) endHour += 12; }
    return {
      dueAt: zonedDate({ ...dateParts, hour: startHour, minute: Number(range[2] || 0) }, timezone),
      dueWindowEndAt: zonedDate({ ...dateParts, hour: endHour, minute: Number(range[4] || 0) }, timezone),
      precision: 'range', timezone, confidence: 0.94,
    };
  }
  const clock = parseClock(source) || (() => {
    const bare = source.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/u);
    return bare ? { hour: Number(bare[1]), minute: Number(bare[2]) } : null;
  })();
  if (clock) {
    const dueAt = zonedDate({ ...dateParts, ...clock }, timezone);
    return { dueAt, dueWindowEndAt: dueAt, precision: 'exact', timezone, confidence: 0.96 };
  }
  const dayPart = Object.entries(DAY_PARTS).find(([name]) => new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, 'iu').test(source));
  const [startHour, endHour] = dayPart ? dayPart[1] : [9, 18];
  return {
    dueAt: zonedDate({ ...dateParts, hour: startHour }, timezone),
    dueWindowEndAt: zonedDate({ ...dateParts, hour: endHour }, timezone),
    precision: dayPart ? 'day_part' : 'day', timezone, confidence: dayPart ? 0.92 : 0.82,
  };
}

module.exports = { DAY_PARTS, WEEKDAYS, parseTemporal, zonedDate, zonedParts };
