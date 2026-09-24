const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeOperationalLogs } = require('../src/operations/collectors/logCollector');

test('archived logs retain operational severity without source content or credentials', () => {
  const entries = normalizeOperationalLogs('2026-09-06T10:00:00Z {"level":50,"msg":"failed to process private family document","token":"private-secret"}\n2026-09-06T10:00:01Z INFO parser found private job\n2026-09-06T10:00:02Z WARNING user private message');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((item) => item.priority), [3, 4]);
  assert.equal(JSON.stringify(entries).includes('private'), false);
  assert.equal(entries[0].observedAt.toISOString(), '2026-09-06T10:00:00.000Z');
});

test('archived Telegram failures retain only a closed diagnostic code', () => {
  const entries = normalizeOperationalLogs('2026-09-20T18:06:59Z {"level":40,"telegramFailureCode":"MODEL_UNAVAILABLE","msg":"Telegram update recovered with fallback reply","privateText":"не сохранять"}\n2026-09-20T18:07:00Z {"level":40,"telegramFailureCode":"unsafe value with spaces","msg":"warning"}');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].message, 'Telegram update: MODEL_UNAVAILABLE');
  assert.equal(entries[0].priority, 4);
  assert.equal(entries[1].message, 'В журнале сервиса зафиксировано предупреждение');
  assert.equal(JSON.stringify(entries).includes('privateText'), false);
  assert.equal(JSON.stringify(entries).includes('не сохранять'), false);
});
