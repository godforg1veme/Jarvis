const u = require('./parserUtils');
function parse(item) { const carrier = u.text(item.carrier, 120, 'carrier'); const occurredAt = u.timestamp(item.updatedAt); return u.result('deliveries', item.id, occurredAt, `Доставка ${carrier}: ${u.text(item.state, 40, 'state')}`, { carrier, trackingHash: u.hashRef(item.trackingReference), state: u.text(item.state, 40, 'state'), windowStart: item.windowStart ? u.timestamp(item.windowStart) : null, windowEnd: item.windowEnd ? u.timestamp(item.windowEnd) : null, exceptionCode: u.optionalText(item.exceptionCode, 80) }); }
module.exports = { parse };
