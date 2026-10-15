const test = require('node:test');
const assert = require('node:assert/strict');
const { applicationReference } = require('../src/applicationProof');

test('recovery reference binds a unique source application to the frozen resume and vacancy', () => {
  const input = { externalId: '123', resumeId: 'fixtureResume' };
  const topic = { id: 444, chatId: 555, resumeId: 222, vacancyId: 123, hasResponseLetter: true, letterResource: true };
  const raw = { selected: { id: 222, hash: input.resumeId }, usedIds: [222], topics: [topic] };
  assert.deepEqual(applicationReference(raw, input), { topicId: '444', chatId: '555' });
  for (const changed of [{ ...raw, usedIds: [] }, { ...raw, selected: { id: 222, hash: 'otherResume' } },
    { ...raw, topics: [topic, topic] }, { ...raw, topics: [{ ...topic, vacancyId: 124 }] },
    { ...raw, topics: [{ ...topic, resumeId: 223 }] }, { ...raw, topics: [{ ...topic, hasResponseLetter: false }] },
    { ...raw, topics: [{ ...topic, id: Number.MAX_SAFE_INTEGER + 1 }] }]) assert.equal(applicationReference(changed, input), null);
});
