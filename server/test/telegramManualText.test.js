const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTelegramMessage } = require('../src/telegram/messageService');
const { TelegramMenuService } = require('../src/telegram/telegramMenuService');

function message(text) {
  return { update_id: 1, message: { message_id: 2, from: { id: 101 }, chat: { id: 101, type: 'private' }, text } };
}
const context = { user: { id: 'fixture-user' }, conversation: { id: 'fixture-conversation' }, chatId: '101' };

test('original text is bounded and excluded from serialized message context', () => {
  const input = normalizeTelegramMessage(message('  First paragraph\n\nSecond.  \n'));
  assert.equal(input.text, 'First paragraph\n\nSecond.');
  assert.equal(input.rawText, '  First paragraph\n\nSecond.  \n');
  assert.equal(Object.hasOwn({ ...input }, 'rawText'), false);
  assert.equal(JSON.stringify(input).includes('rawText'), false);
  const long = normalizeTelegramMessage(message(' '.repeat(10001) + 'draft'));
  assert.equal(long.text, 'draft');
  assert.equal(long.rawText, undefined);
  assert.equal(long.rawTextTooLong, true);
});

test('only a scoped active manual draft receives untrimmed text; invalid retry is not consumed', async () => {
  const received = [];
  let kind = 'job_draft_manual_edit';
  const service = new TelegramMenuService({
    interactions: { async getActive() { return { interaction: { id: 'fixture', kind } }; } },
    jobSearchService: { async handlePendingText(text) { received.push(text); return { answer: 'preview' }; } },
  });
  await service.handlePendingText('trimmed', context, { rawText: '  original\n  ' });
  assert.equal(received[0], '  original\n  ');
  const invalid = await service.handlePendingText('draft', context, { rawTextTooLong: true });
  assert.match(invalid.answer, /10 000/);
  assert.equal(received.length, 1);
  kind = 'job_draft_edit';
  await service.handlePendingText('  AI edit  ', context, { rawText: '  original\n  ' });
  assert.equal(received[1], 'AI edit');
});
