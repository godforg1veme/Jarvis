const assert = require('node:assert/strict');
const test = require('node:test');
const { IncidentEngine } = require('../src/operations/incidents/incidentEngine');

test('a failed notification is retried without repeating service actions', async () => {
  let deliveries = 0; let marked = 0;
  const engine = new IncidentEngine({ hostId: 'host', repository: {
    async openOrUpdateIncident() { return { id: 'incident', opened: false }; },
    async claimIncidentNotification() { return marked === 0; },
    async markIncidentNotified() { marked++; },
  }, notifier: { async notify() { deliveries++; return deliveries > 1; } } });
  const service = { id: 'service', serviceKey: 'jarvis-server', sourceState: 'failed' };
  await engine.observe(service);
  assert.equal(marked, 0);
  await engine.observe(service);
  await engine.observe(service);
  assert.equal(deliveries, 2);
  assert.equal(marked, 1);
});

test('incident engine opens after three ordinary failures and notifies once', async () => {
  const opened = []; const notified = []; let existing = false;
  const engine = new IncidentEngine({ hostId: 'host-1', repository: {
    async openOrUpdateIncident(input) { opened.push(input); const result = { id: 'incident-1', summary: input.summary, opened: !existing }; existing = true; return result; },
    async resolveServiceIncidents() {},
  }, notifier: { async notify(incident) { notified.push(incident); } } });
  const service = { id: 'service-1', serviceKey: 'jarvis-server', displayName: 'Jarvis Server', sourceState: 'inactive', healthState: 'unavailable' };
  await engine.observe(service); await engine.observe(service); await engine.observe(service); await engine.observe(service);
  assert.equal(opened.length, 2);
  assert.equal(notified.length, 1);
});

test('systemd failed opens immediately and recovery resolves silently', async () => {
  const calls = [];
  const engine = new IncidentEngine({ hostId: 'host-1', repository: {
    async openOrUpdateIncident() { calls.push('open'); return { opened: false }; },
    async resolveServiceIncidents() { calls.push('resolve'); },
  } });
  const base = { id: 'service-1', serviceKey: 'telegram-parser', displayName: 'Telegram Parser' };
  await engine.observe({ ...base, sourceState: 'failed', healthState: 'unavailable' });
  await engine.observe({ ...base, sourceState: 'active', healthState: 'healthy' });
  assert.deepEqual(calls, ['open', 'resolve']);
});
