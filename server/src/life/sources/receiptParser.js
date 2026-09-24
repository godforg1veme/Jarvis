const u = require('./parserUtils');
function parse(item) { const merchant = u.text(item.merchant, 160, 'merchant'); const date = u.timestamp(item.date); return u.result('receipts', item.id, date, `Платёж: ${merchant}`, { merchant, date, currency: u.currency(item.currency), total: u.amount(item.total), dueState: u.text(item.dueState || 'paid', 32, 'state'), category: u.optionalText(item.category, 80) }); }
module.exports = { parse };
