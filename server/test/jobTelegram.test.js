const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseJobCallback, isJobVacancyUrl } = require('../src/jobs/jobTelegramCallbacks');
const { sendResult, telegramReplyMarkup } = require('../src/telegram/bot');
const { cardView, draftView } = require('../src/jobs/jobTelegramViews');
const { parseSettingsEdit, parseProfileEdit } = require('../src/jobs/jobSettingsService');
const { defaultJobSettings } = require('../src/jobs/jobSearchDefaults');

test('job callback and external URL grammar is closed and bounded', () => {
  assert.equal(parseJobCallback('job:menu').action, 'menu');
  assert.equal(parseJobCallback(`job:prepare:${crypto.randomUUID()}`).action, 'prepare');
  for (const bad of ['job:shell:hello', 'job:saved:-1', 'job:saved:10000', 'job:menu:extra', `job:edit:${'a'.repeat(80)}`]) assert.equal(parseJobCallback(bad), null);
  assert.equal(isJobVacancyUrl('https://hh.ru/vacancy/123'), true);
  for (const bad of ['https://hh.ru.evil.example/vacancy/123', 'https://hh.ru@evil.example/vacancy/123',
    'https://hh.ru/vacancy/123?token=x', 'http://hh.ru/vacancy/123', 'https://example.org/']) assert.equal(isJobVacancyUrl(bad), false);
});

test('cards and draft preview deliver literal text with validated buttons', async () => {
  const id = crypto.randomUUID();
  const text = '<b>Literal & text</b> [unchanged](https://example.org)';
  const draft = draftView({ id, text });
  const sends = [];
  await sendResult({ reply: async (...args) => { sends.push(args); } }, { status: 'answered', ...draft });
  assert.ok(sends[0][0].includes(text)); assert.equal(sends[0][1].parse_mode, undefined);
  assert.deepEqual(sends[0][1].link_preview_options, { is_disabled: true });
  assert.ok(telegramReplyMarkup(draft.buttons));
  const card = cardView({ id, annotations: ['SALARY_UNKNOWN'], snapshot: { title: 'AI Engineer', company: 'Fixture',
    publishedAt: '2026-10-15', url: 'https://hh.ru/vacancy/123', description: 'Доход 150 000 рублей на руки в месяц' } });
  assert.ok(telegramReplyMarkup(card.buttons));
  assert.ok(card.answer.includes('Доход нужно уточнить'));
  assert.match(card.answer, /В описании: от 150/);
  const cardSends = [];
  await sendResult({ reply: async (...args) => { cardSends.push(args); } }, { status: 'answered', ...card });
  assert.deepEqual(cardSends[0][1].link_preview_options, { is_disabled: true });
  assert.ok(cardSends[0][0].includes('https://hh.ru/vacancy/123'));
  assert.equal(cardSends[0][1].reply_markup.inline_keyboard[0][0].url, 'https://hh.ru/vacancy/123');
  const longSends = [];
  await sendResult({ reply: async (...args) => { longSends.push(args); } }, { status: 'answered',
    ...draftView({ id, text: `https://hh.ru/vacancy/123\n${'Текст письма. '.repeat(400)}` }) });
  assert.ok(longSends.length > 1);
  assert.ok(longSends.every((entry) => entry[1].link_preview_options?.is_disabled === true), 'the URL may occur before the final chunk');
});

test('settings use validated owner input without exposing internal JSON', () => {
  const next = parseSettingsEdit('зарплата = 120000\nзапрос + AI Designer\nинтервал = 15\nвключить', defaultJobSettings());
  assert.equal(next.targetRub, 120000); assert.equal(next.intervalMs, 900000);
  assert.equal(next.activated, true); assert.ok(next.queries.includes('AI Designer'));
  assert.throws(() => parseSettingsEdit('интервал = 0', defaultJobSettings()));
  assert.throws(() => parseSettingsEdit('run powershell', defaultJobSettings()));
  assert.equal(parseProfileEdit('факт: Participated in fixture automation', { confirmed: false, facts: [], examples: [] }).confirmed, true);
});
