const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { parseMoscowInput, formatMoscowDateTime, moscowIso } = require('../../shared/time');

test('timezone-free reminder input means fixed Moscow time and explicit offsets retain the instant', () => {
  for (const input of ['2026-10-18 23:46', '2026-10-18T23:46:00', '18.10.2026 23:46', '2026-10-18T23:46:00+03:00'])
    assert.equal(parseMoscowInput(input), '2026-10-18T20:46:00.000Z');
  assert.equal(parseMoscowInput('2026-10-18T23:46:00Z'), '2026-10-18T23:46:00.000Z');
  assert.equal(parseMoscowInput('2026-10-19 00:01'), '2026-10-18T21:01:00.000Z');
  assert.equal(parseMoscowInput('2026-10-18T23:46:00.12-04:00'), '2026-10-19T03:46:00.120Z');
});

test('invalid calendar and ambiguous values do not roll over into another reminder date', () => {
  for (const input of ['2026-02-30 12:00', '2025-02-29 12:00', '2026-13-01 12:00', '2026-10-18 24:00', '2026-10-18 12:60', '2026-10-18', 'tomorrow', '', '2026-10-18T12:00+14:30', null])
    assert.throws(() => parseMoscowInput(input));
  assert.equal(parseMoscowInput('2028-02-29 12:00'), '2028-02-29T09:00:00.000Z');
});

test('Moscow rendering, parsing and midnight rollover are independent of host timezone', () => {
  const modulePath = require.resolve('../../shared/time');
  const code = `const t=require(${JSON.stringify(modulePath)});console.log(JSON.stringify([t.parseMoscowInput('2026-10-18 23:46'),t.formatMoscowDateTime('2026-10-18T20:46:00Z'),t.formatMoscowDateTime('2026-10-18T21:01:00Z'),t.formatMoscowDateTime('2000-06-01T00:00:00Z')]))`;
  const outputs = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map((TZ) => {
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, TZ } });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  });
  assert.deepEqual(outputs[0], outputs[1]); assert.deepEqual(outputs[0], outputs[2]);
  assert.match(outputs[0][1], /18\.10\.2026.*23:46:00.*МСК/);
  assert.match(outputs[0][2], /19\.10\.2026.*00:01:00.*МСК/);
  assert.match(outputs[0][3], /03:00:00/, 'fixed UTC+3 even for historical dates');
});

test('server clock is Moscow ISO and invalid display values have a safe fallback', () => {
  assert.equal(moscowIso('2026-10-18T21:01:00Z'), '2026-10-19T00:01:00.000+03:00');
  assert.equal(formatMoscowDateTime('invalid'), '—');
  assert.equal(formatMoscowDateTime(null, 'без срока'), 'без срока');
});
