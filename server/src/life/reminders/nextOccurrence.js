const { zonedDate, zonedParts } = require('../commitments/temporalParser');

function localDay(parts, offset) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth(), day: value.getUTCDate() };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function nextOccurrence(triggerAt, recurrence, timezone = 'UTC') {
  if (!recurrence) return null;
  const current = triggerAt instanceof Date ? triggerAt : new Date(triggerAt);
  if (Number.isNaN(current.getTime())) return null;
  if (recurrence.kind === 'interval') return new Date(current.getTime() + recurrence.minutes * 60000);
  const parts = zonedParts(current, timezone);
  const time = { hour: parts.hour, minute: parts.minute };
  if (recurrence.kind === 'daily') {
    return zonedDate({ ...localDay(parts, recurrence.interval || 1), ...time }, timezone);
  }
  if (recurrence.kind === 'weekdays') {
    const allowed = new Set(recurrence.weekdays || [1, 2, 3, 4, 5]);
    for (let offset = 1; offset <= 7; offset += 1) {
      const day = localDay(parts, offset);
      const weekday = new Date(Date.UTC(day.year, day.month, day.day)).getUTCDay() || 7;
      if (allowed.has(weekday)) return zonedDate({ ...day, ...time }, timezone);
    }
  }
  if (recurrence.kind === 'weekly') {
    const currentWeekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() || 7;
    let offset = (recurrence.weekday - currentWeekday + 7) % 7;
    if (offset === 0) offset = 7 * (recurrence.interval || 1);
    else if ((recurrence.interval || 1) > 1) offset += 7 * ((recurrence.interval || 1) - 1);
    return zonedDate({ ...localDay(parts, offset), ...time }, timezone);
  }
  if (recurrence.kind === 'monthly_date') {
    const monthOffset = recurrence.interval || 1;
    const base = new Date(Date.UTC(parts.year, parts.month - 1 + monthOffset, 1));
    const year = base.getUTCFullYear(); const month = base.getUTCMonth();
    const day = Math.min(recurrence.day, daysInMonth(year, month));
    return zonedDate({ year, month, day, ...time }, timezone);
  }
  return null;
}

module.exports = { nextOccurrence };
