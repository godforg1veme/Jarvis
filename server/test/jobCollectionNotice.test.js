const test = require('node:test');
const assert = require('node:assert/strict');
const { collectionNoticeView } = require('../src/jobs/jobCollectionNotices');
const { parseJobCallback } = require('../src/jobs/jobTelegramCallbacks');

test('incomplete collection notice is closed, useful and uses only the existing menu callback', () => {
  const view = collectionNoticeView('INCOMPLETE');
  assert.match(view.answer, /не заверш[её]н/iu);
  assert.match(view.answer, /Прогресс сохран[её]н/iu);
  assert.equal(view.disableLinkPreview, true);
  assert.equal(view.buttons[0][0].data, 'job:menu');
  assert.equal(parseJobCallback(view.buttons[0][0].data).action, 'menu');
  for (const code of ['__proto__', 'SECRET private query', {}, null]) assert.equal(collectionNoticeView(code), null);
  assert.equal(/JOB_|https?:\/\//.test(view.answer), false);
});
