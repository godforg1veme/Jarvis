const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function splitWindow(window, granularity) {
  const from = Date.parse(window.from), to = Date.parse(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  let boundary;
  if (granularity === 'moscow_day') {
    const firstDay = Math.floor((from + MOSCOW_OFFSET_MS) / DAY_MS);
    const lastDay = Math.floor((to + MOSCOW_OFFSET_MS) / DAY_MS);
    if (firstDay === lastDay) return null;
    const middleDay = Math.floor((firstDay + lastDay + 1) / 2);
    boundary = middleDay * DAY_MS - MOSCOW_OFFSET_MS;
  } else {
    if (to - from <= 10 * 60 * 1000) return null;
    boundary = Math.floor((from + to) / 2 / 300000) * 300000;
  }
  if (boundary <= from || boundary > to) return null;
  return [
    { query: window.query, from: window.from, to: new Date(boundary - 1).toISOString(), page: 0, offset: 0 },
    { query: window.query, from: new Date(boundary).toISOString(), to: window.to, page: 0, offset: 0 },
  ];
}

function calendarSearchFrom(window, now) {
  const from = Date.parse(window.from);
  if (now.getTime() - from < 29 * DAY_MS) return window.from;
  // HH search uses calendar dates. Use a later instant on the SAME Moscow day
  // to avoid the browser's 30-day age guard expiring during RPC/queue latency.
  // Exact filtering still uses the original saved bounds, never this transport value.
  const endOfDay = (Math.floor((from + MOSCOW_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - MOSCOW_OFFSET_MS - 1;
  return new Date(Math.min(endOfDay, Date.parse(window.to))).toISOString();
}

module.exports = { splitWindow, calendarSearchFrom };
