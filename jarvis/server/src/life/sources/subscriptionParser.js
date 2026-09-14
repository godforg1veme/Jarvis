const u = require('./parserUtils');
function parse(item) { const merchant = u.text(item.merchant, 160, 'merchant'); const nextExpectedAt = u.timestamp(item.nextExpectedAt); return u.result('subscriptions', item.id, nextExpectedAt, `Подписка: ${merchant}`, { merchant, amount: u.amount(item.amount), currency: u.currency(item.currency), cadence: u.text(item.cadence, 80, 'cadence'), nextExpectedAt, state: u.text(item.state, 40, 'state') }); }
module.exports = { parse };
