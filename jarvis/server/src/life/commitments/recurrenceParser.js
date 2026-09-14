const { normalizedLower } = require('./textNormalizer');

function parseRecurrence(text, locale = 'ru-RU', options = {}) {
  const source = normalizedLower(text, locale);
  const anchor = options.anchorDate instanceof Date ? options.anchorDate : new Date(options.anchorDate || Date.now());
  const timezone = options.timezone || 'UTC';
  if (/(?<![\p{L}\p{N}_])(?:каждый день|ежедневно|every day|daily)(?![\p{L}\p{N}_])/iu.test(source)) return { kind: 'daily', interval: 1 };
  if (/(?<![\p{L}\p{N}_])(?:по будням|каждый будний день|weekdays)(?![\p{L}\p{N}_])/iu.test(source)) return { kind: 'weekdays', weekdays: [1, 2, 3, 4, 5] };
  const weekday = [
    ['понедельник|monday', 1], ['вторник|tuesday', 2], ['среду|среда|wednesday', 3],
    ['четверг|thursday', 4], ['пятницу|пятница|friday', 5], ['субботу|суббота|saturday', 6], ['воскресенье|sunday', 7],
  ].find(([pattern]) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, 'iu').test(source));
  if (/(?<![\p{L}\p{N}_])(?:каждую неделю|еженедельно|every week|weekly|каждый понедельник|каждый вторник|каждую среду|каждый четверг|каждую пятницу)(?![\p{L}\p{N}_])/iu.test(source)
    || (weekday && /(?<![\p{L}\p{N}_])(?:кажд(?:ый|ую)|every)(?![\p{L}\p{N}_])/iu.test(source))) {
    const weekdayLabel = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(anchor);
    const anchorWeekday = Math.max(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekdayLabel) + 1, 1);
    return { kind: 'weekly', weekday: weekday?.[1] || anchorWeekday, interval: 1 };
  }
  const monthDay = source.match(/(?<![\p{L}\p{N}_])(?:каждого|every month on)\s+(\d{1,2})(?:-?(?:го|th|st|nd|rd))?(?![\p{L}\p{N}_])/iu);
  if (/(?<![\p{L}\p{N}_])(?:каждый месяц|ежемесячно|every month|monthly)(?![\p{L}\p{N}_])/iu.test(source) || monthDay) {
    const anchorDay = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: 'numeric' }).format(anchor));
    return { kind: 'monthly_date', day: Math.min(Math.max(Number(monthDay?.[1] || anchorDay), 1), 31), interval: 1 };
  }
  const interval = source.match(/(?<![\p{L}\p{N}_])(?:каждые|каждый|every)\s+(\d{1,2})\s+(?:д(?:ень|ня|ней)|days?)(?![\p{L}\p{N}_])/iu);
  if (interval) return { kind: 'interval', minutes: Math.min(Math.max(Number(interval[1]), 2), 365) * 1440 };
  return null;
}

module.exports = { parseRecurrence };
