const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateVacancy } = require('../src/jobs/jobFilters');
const { evaluateSalary } = require('../src/jobs/salaryRules');
const { defaultJobSettings } = require('../src/jobs/jobSearchDefaults');
const settings = defaultJobSettings();
const vacancy = (overrides = {}) => ({ title: 'Senior AI Engineer', description: 'LLM integration',
  city: 'Москва', workFormat: 'office', salary: null, ...overrides });

test('broad AI, ML, research, junior and QA search never filters by seniority or education', () => {
  for (const title of ['Senior AI Engineer', 'Junior AI', 'Prompt Engineer', 'Промт-инженер',
    'AI QA Engineer', 'Тестировщик чат-ботов', 'Research Scientist', 'ML Engineer',
    'AI Enablement Engineer', 'NLP Engineer', 'RAG Developer', 'Стажёр AI']) {
    assert.equal(evaluateVacancy({ vacancy: vacancy({ title, experience: '6+ years', education: 'PhD' }), settings }).include, true, title);
  }
});

test('ordinary AI user, sales duties and definite foreign-only remote are excluded', () => {
  const cases = [vacancy({ title: 'Бухгалтер', description: 'Можно использовать ChatGPT для работы' }),
    vacancy({ title: 'Менеджер по продажам AI', description: 'Холодные звонки клиентам' }),
    vacancy({ workFormat: 'remote', remoteRestriction: 'foreign_only' }),
    vacancy({ city: 'Казань', workFormat: 'hybrid' })];
  for (const item of cases) assert.equal(evaluateVacancy({ vacancy: item, settings }).include, false);
  assert.equal(evaluateVacancy({ vacancy: vacancy({ description: 'Автоматизация отдела продаж с AI' }), settings }).include, true);
  const unknownRemote = evaluateVacancy({ vacancy: vacancy({ city: 'Other', workFormat: 'remote' }), settings });
  assert.equal(unknownRemote.include, true);
  assert.ok(unknownRemote.annotations.includes('REMOTE_ELIGIBILITY_UNKNOWN'));
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
