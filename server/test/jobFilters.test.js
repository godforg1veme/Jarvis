const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateVacancy } = require('../src/jobs/jobFilters');
const { evaluateSalary } = require('../src/jobs/salaryRules');
const { defaultJobSettings } = require('../src/jobs/jobSearchDefaults');
const settings = defaultJobSettings();
const vacancy = (overrides = {}) => ({ title: 'Senior AI Engineer', description: 'LLM integration',
  city: 'Москва', workFormat: 'office', salary: null, ...overrides });

test('new filters are empty and do not impose an AI, sales, salary or location preference', () => {
  assert.deepEqual(settings.queries, []);
  assert.deepEqual(settings.exclusions, []);
  assert.equal(settings.targetRub, null);
  assert.equal(settings.officeCity, '');
  assert.equal(settings.remote, null);
  for (const item of [vacancy({ title: 'Бухгалтер', city: 'Казань', salary: { to: 10000, currency: 'RUR', gross: false } }),
    vacancy({ title: 'Менеджер по продажам', description: 'Холодные звонки', workFormat: 'remote', remoteRestriction: 'foreign_only' })]) {
    assert.equal(evaluateVacancy({ vacancy: item, settings }).include, true);
  }
});

test('explicit saved location and exclusions still apply', () => {
  const saved = { ...settings, remote: true, officeCity: 'Москва', exclusions: ['холодные звонки'] };
  for (const item of [vacancy({ description: 'Холодные звонки клиентам' }),
    vacancy({ workFormat: 'remote', remoteRestriction: 'foreign_only' }),
    vacancy({ city: 'Казань', workFormat: 'hybrid' })]) {
    assert.equal(evaluateVacancy({ vacancy: item, settings: saved }).include, false);
  }
  const unknownRemote = evaluateVacancy({ vacancy: vacancy({ city: 'Other', workFormat: 'remote' }), settings: saved });
  assert.equal(unknownRemote.include, true);
  assert.ok(unknownRemote.annotations.includes('REMOTE_ELIGIBILITY_UNKNOWN'));
  assert.equal(evaluateVacancy({ vacancy: vacancy({ workFormat: 'remote' }), settings: { ...saved, remote: false } }).include, false);
});

test('salary gates only proven monthly net amounts and preserves uncertainty', () => {
  const check = (salary, description = '', rateSnapshot) => evaluateSalary({ salary, description, targetRub: 100000, rateSnapshot });
  assert.equal(check({ from: 100000, currency: 'RUR', gross: false }).include, true);
  assert.equal(check({ from: 80000, to: 150000, currency: 'RUR', gross: false }).include, true);
  assert.equal(check({ to: 120000, currency: 'RUR', gross: false }).include, true);
  assert.equal(check({ to: 99000, currency: 'RUR', gross: false }).include, false);
  assert.equal(check({ from: 90000, currency: 'RUR', gross: true }).include, true);
  assert.equal(check({ from: 90000, currency: 'RUR' }).include, true);
  assert.equal(check({ from: 1000, currency: 'USD', gross: false }).include, true);
  assert.equal(check({ from: 1000, currency: 'USD', gross: false }, '', { date: '2026-10-15', fresh: true, rates: { USD: 80 } }).include, false);
  assert.equal(check({ from: 90000, currency: 'RUR', gross: false, period: 'hour' }).include, true);
  assert.equal(check(null, 'Доход 150 000 рублей на руки в месяц').include, true);
  assert.equal(check(null, 'Оплата 90 000 рублей на руки в месяц').include, false);
  assert.equal(check(null, 'Оплата 90 000 рублей в год').include, true);
  const conflict = check({ from: 90000, currency: 'RUR', gross: false }, 'Доход 150 000 рублей на руки в месяц');
  assert.equal(conflict.include, true);
  assert.ok(conflict.annotations.includes('SALARY_CONFLICT'));
});
