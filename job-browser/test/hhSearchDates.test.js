const test = require('node:test');
const assert = require('node:assert/strict');
const { hhDate } = require('../src/hhSearchDates');

test('HH dates use fixed Moscow UTC+3 at the day boundary', () => {
  assert.equal(hhDate('2026-10-20T20:59:59.999Z'), '20.10.2026');
  assert.equal(hhDate('2026-10-20T21:00:00.000Z'), '21.10.2026');
  assert.equal(hhDate('2026-01-31T21:00:00.000Z'), '01.02.2026');
});
