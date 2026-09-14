const u = require('./parserUtils');
function parse(item) { const title = u.text(item.title, 300, 'title'); const startAt = u.timestamp(item.startAt, 'start'); const endAt = u.timestamp(item.endAt, 'end'); if (endAt < startAt) throw new Error('calendar range is invalid');
  return u.result('calendar', item.id, startAt, `Календарь: ${title}`, { title, startAt, endAt, timezone: u.timezone(item.timezone), status: u.text(item.status || 'confirmed', 32, 'status'), attendees: u.list(item.attendees || [], 20, (value) => u.text(value, 120, 'attendee')), recurrence: u.optionalText(item.recurrence, 200), conflictKey: u.optionalText(item.conflictKey, 128) }); }
module.exports = { parse };
