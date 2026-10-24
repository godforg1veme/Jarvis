const test = require('node:test');
const assert = require('node:assert/strict');
const { hhId, readSalary, normalizeSearch, normalizeVacancy } = require('../src/hhPageReader');
const card = (id) => [`https://hh.ru/vacancy/${id}`, `https://hh.ru/vacancy/${id}?from=search`];
test('clipped pager still reports broad metadata; actual page and next query stay bound', () => {
  const expected = 'https://hh.ru/search/vacancy?text=AI&date_from=20.10.2026&date_to=21.10.2026&order_by=publication_time&items_on_page=20&page=0';
  const cards = Array.from({ length: 20 }, (_, i) => card(i + 1));
  const raw = { url: expected, heading: '8953 вакансии', cards, pageLinks: ['https://hh.ru/search/vacancy?page=99'],
    nextLinks: [expected.replace('page=0', 'page=1')] };
  assert.deepEqual(normalizeSearch(raw, expected), { items: cards.map((_, i) => ({ id: String(i + 1) })), found: 8953, pages: 448 });
  assert.throws(() => normalizeSearch({ ...raw, url: expected.replace('page=0', 'page=1') }, expected), { code: 'JOB_HH_DOM_CHANGED' });
  assert.throws(() => normalizeSearch({ ...raw, nextLinks: [expected.replace('date_from=20.10.2026', 'date_from=19.10.2026').replace('page=0', 'page=1')] }, expected), { code: 'JOB_HH_DOM_CHANGED' });
  assert.throws(() => normalizeSearch({ ...raw, nextLinks: [] }, expected), { code: 'JOB_HH_DOM_CHANGED' });
});

test('search counts and pagination agree; lazy or capped pagination cannot silently complete', () => {
  const cards = Array.from({ length: 20 }, (_, index) => card(123 + index));
  const raw = { heading: '513 вакансий «AI Engineer»', cards, pageLinks: ['https://hh.ru/search/vacancy?page=25'] };
  assert.deepEqual(normalizeSearch(raw), { items: cards.map((_, index) => ({ id: String(123 + index) })), found: 513, pages: 26 });
  assert.equal(normalizeSearch({ ...raw, pageLinks: [] }).found, 513);
  assert.throws(() => normalizeSearch({ ...raw, cards: [] }), { code: 'JOB_HH_DOM_CHANGED' });
  assert.throws(() => normalizeSearch({ ...raw, cards: cards.slice(0, 19) }), { code: 'JOB_HH_DOM_CHANGED' });
  assert.throws(() => normalizeSearch({ ...raw, cards: [card(123), card(123)] }), { code: 'JOB_HH_DOM_CHANGED' });
  assert.deepEqual(normalizeSearch({ heading: 'Найдено 0 вакансий', cards: [], pageLinks: [] }), { items: [], found: 0, pages: 0 });
  assert.deepEqual(normalizeSearch({ heading: 'По\u00a0запросу «Fixture» ничего не\u00a0найдено', emptyMarker: true,
    cards: [], pageLinks: [] }), { items: [], found: 0, pages: 0 });
  assert.throws(() => normalizeSearch({ heading: 'По запросу «Fixture» ничего не найдено', cards: [], pageLinks: [] }));
  assert.throws(() => normalizeSearch({ heading: 'Не удалось загрузить', cards: [], pageLinks: [] }));
});

test('only canonical HH entity paths supply identifiers', () => {
  assert.equal(hhId('https://hh.ru/vacancy/123?from=search'), '123');
  for (const url of ['https://hh.ru.evil.test/vacancy/123', 'https://evil.test/vacancy/123',
    'http://hh.ru/vacancy/123', 'https://user@hh.ru/vacancy/123', 'https://hh.ru:444/vacancy/123']) assert.equal(hhId(url), null);
});

test('visible salary preserves currency, tax and period; uncertain labels do not become monthly net pay', () => {
  assert.deepEqual(readSalary('от\u00a0700\u00a0до\u00a01\u00a0000\u00a0$ за\u00a0месяц, до вычета налогов'),
    { from: 700, to: 1000, currency: 'USD', gross: true, period: 'month' });
  assert.deepEqual(readSalary('80 000 – 150 000 ₽ за месяц, на руки'),
    { from: 80000, to: 150000, currency: 'RUB', gross: false, period: 'month' });
  assert.deepEqual(readSalary('до 90 000 ₽ за месяц, на руки'),
    { from: null, to: 90000, currency: 'RUB', gross: false, period: 'month' });
  assert.equal(readSalary('от 80 000 ₽ за смену')?.period, 'unknown');
  assert.equal(readSalary('от 80 000 ₽ за месяц с бонусами')?.period, 'unknown');
  assert.equal(readSalary('по договорённости'), null);
});

test('vacancy dates require source timezone and missing conditions remain unknown', () => {
  const posting = { '@type': 'JobPosting', title: 'Junior AI', datePosted: '2026-10-15T10:22:35.332+03:00',
    hiringOrganization: { name: 'Fixture' }, jobLocation: { address: { addressLocality: 'Москва' } } };
  const raw = { url: 'https://hh.ru/vacancy/123', jsonLd: [JSON.stringify(posting)], description: 'Проект автоматизации' };
  const result = normalizeVacancy(raw, '123');
  assert.equal(result.publishedAt, '2026-10-15T07:22:35.332Z');
  assert.equal(result.salary, null); assert.equal(result.workFormat, 'unknown'); assert.equal(result.city, 'Москва');
  assert.equal(normalizeVacancy({ ...raw, workFormat: 'Формат работы: на\u00a0месте работодателя' }, '123').workFormat, 'office');
  const withDate = (datePosted) => ({ ...raw, jsonLd: [JSON.stringify({ ...posting, datePosted })] });
  assert.throws(() => normalizeVacancy(withDate('2026-10-15'), '123'));
  assert.throws(() => normalizeVacancy(withDate('2026-10-15T10:22:35'), '123'));
  assert.throws(() => normalizeVacancy({ ...raw, url: 'https://hh.ru/vacancy/124' }, '123'));
  assert.throws(() => normalizeVacancy({ ...raw, jsonLd: [...raw.jsonLd, ...raw.jsonLd] }, '123'));
  const paid = normalizeVacancy({ ...raw, jsonLd: [JSON.stringify({ ...posting,
    baseSalary: { currency: 'RUB', value: { minValue: 80000, maxValue: 150000, unitText: 'MONTH' } } })] }, '123');
  assert.deepEqual(paid.salary, { from: 80000, to: 150000, currency: 'RUB', gross: null, period: 'month' });
});
