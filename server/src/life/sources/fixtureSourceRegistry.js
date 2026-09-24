const { LifeSourceAdapter } = require('./lifeSourceAdapter');
const { SourceRegistry } = require('./sourceRegistry');
const { FakeSourceTransport } = require('./fakeSourceTransport');

const PARSERS = Object.freeze({
  calendar: require('./calendarParser'), email: require('./emailParser'), tasks: require('./taskParser'),
  receipts: require('./receiptParser'), deliveries: require('./deliveryParser'), travel: require('./travelParser'),
  subscriptions: require('./subscriptionParser'), smart_home: require('./smartHomeParser'),
});

function createFixtureSourceRegistry(pagesByType = {}) {
  const registry = new SourceRegistry();
  for (const [type, parser] of Object.entries(PARSERS)) registry.register(new LifeSourceAdapter({
    type, schemaVersion: 1, parser, transport: new FakeSourceTransport(pagesByType[type] || {}),
  }));
  return registry;
}

module.exports = { PARSERS, createFixtureSourceRegistry };
