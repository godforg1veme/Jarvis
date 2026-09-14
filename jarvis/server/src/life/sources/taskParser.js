const u = require('./parserUtils');
function parse(item) { const title = u.text(item.title, 300, 'title'); const occurredAt = u.timestamp(item.updatedAt || item.dueAt); return u.result('tasks', item.id, occurredAt, `Задача: ${title}`, { title, state: u.text(item.state, 32, 'state'), dueAt: item.dueAt ? u.timestamp(item.dueAt) : null, dueWindowEndAt: item.dueWindowEndAt ? u.timestamp(item.dueWindowEndAt) : null, recurrence: u.optionalText(item.recurrence, 200), listLabel: u.optionalText(item.listLabel, 160), externalRefHash: u.hashRef(item.id) }); }
module.exports = { parse };
