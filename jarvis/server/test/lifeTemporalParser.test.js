const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTemporal, zonedParts } = require('../src/life/commitments/temporalParser');

const MOSCOW_NOW = new Date('2026-09-14T07:00:00.000Z');

test('parses RU and EN dates, day parts, exact times, ranges, and weekdays', () => {
  const fixtures = [
    ['завтра вечером', 'ru-RU', 'Europe/Moscow', '2026-09-15T15:00:00.000Z', 'day_part'],
    ['15 сентября в 18:30', 'ru-RU', 'Europe/Moscow', '2026-09-15T15:30:00.000Z', 'exact'],
    ['September 15 at 6:30 pm', 'en-US', 'Europe/Moscow', '2026-09-15T15:30:00.000Z', 'exact'],
    ['завтра с 18 до 20', 'ru-RU', 'Europe/Moscow', '2026-09-15T15:00:00.000Z', 'range'],
    ['в следующую среду утром', 'ru-RU', 'Europe/Moscow', '2026-09-23T05:00:00.000Z', 'day_part'],
  ];
  for (const [text, locale, timezone, expected, precision] of fixtures) {
    const result = parseTemporal(text, { now: MOSCOW_NOW, locale, timezone });
    assert.equal(result.dueAt.toISOString(), expected, text);
    assert.equal(result.precision, precision, text);
  }
});

test('timezone and DST boundaries preserve requested local day and hour', () => {
  const result = parseTemporal('tomorrow at 9:00', {
    now: new Date('2026-03-07T15:00:00.000Z'), timezone: 'America/New_York', locale: 'en-US',
  });
  const parts = zonedParts(result.dueAt, 'America/New_York');
  assert.deepEqual({ year: parts.year, month: parts.month, day: parts.day, hour: parts.hour }, { year: 2026, month: 3, day: 8, hour: 9 });
});

test('no-date promise remains a range-free candidate', () => {
  const result = parseTemporal('I will send the report', { now: MOSCOW_NOW, timezone: 'UTC', locale: 'en-US' });
  assert.equal(result.dueAt, null);
  assert.equal(result.precision, 'none');
});
