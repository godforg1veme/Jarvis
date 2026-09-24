const u = require('./parserUtils');
function parse(item) { const type = u.text(item.type, 40, 'type'); const startsAt = u.timestamp(item.startsAt); return u.result('travel', item.id, startsAt, `Поездка: ${u.text(item.routeOrVenue, 300, 'route')}`, { type, providerLabel: u.text(item.providerLabel, 120, 'provider'), startsAt, endsAt: item.endsAt ? u.timestamp(item.endsAt) : null, timezone: u.timezone(item.timezone), routeOrVenue: u.text(item.routeOrVenue, 300, 'route'), state: u.text(item.state, 40, 'state') }); }
module.exports = { parse };
