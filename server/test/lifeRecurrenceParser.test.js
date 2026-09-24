const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecurrence } = require('../src/life/commitments/recurrenceParser');

const options = { anchorDate: new Date('2026-09-14T07:00:00.000Z'), timezone: 'Europe/Moscow' };

test('parses supported recurring commitment families in RU and EN', () => {
  assert.deepEqual(parseRecurrence('Проверять каждый день', 'ru-RU', options), { kind: 'daily', interval: 1 });
  assert.deepEqual(parseRecurrence('Проверять по будням', 'ru-RU', options), { kind: 'weekdays', weekdays: [1, 2, 3, 4, 5] });
  assert.deepEqual(parseRecurrence('Call every Friday', 'en-US', options), { kind: 'weekly', weekday: 5, interval: 1 });
  assert.deepEqual(parseRecurrence('Платить каждого 15-го', 'ru-RU', options), { kind: 'monthly_date', day: 15, interval: 1 });
  assert.deepEqual(parseRecurrence('Review every 3 days', 'en-US', options), { kind: 'interval', minutes: 4320 });
});
