const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyChatData } = require('../src/chatApplicationProof');
const reference = { chatId: '555', topicId: '444' };
const input = { externalId: '123', resumeId: 'fixtureResume', letter: 'Точное письмо\nБез изменений.' };
function fixture() {
  const resources = { NEGOTIATION_TOPIC: ['444'], VACANCY: ['123'], RESUME: ['222'], RESPONSE_LETTER: ['777'] };
  return { chat: { id: 555, currentParticipantId: 'applicant-1', resources,
    messages: { items: [{ chatId: 555, participantId: 'applicant-1', hidden: false,
      resources, workflowTransition: { topicId: 444 }, text: input.letter }] } },
  resources: { negotiation_topics: { 444: { topicId: 444, resumeId: 222, vacancyId: 123 } },
    vacancies: { 123: { vacancyId: 123 } }, resumes: { 222: { id: 222, hash: 'fixtureResume' } },
    participants: { 'applicant-1': { key: 'different-ui-key', isCurrentUser: true } } } };
}
test('GET proof binds own exact letter to source topic/chat/vacancy/selected resume', async () => {
  assert.equal(await verifyChatData({ reference, input, data: fixture() }), true);
  const opaque = fixture();
  opaque.chat.resources.RESUME = ['fixtureResume'];
  opaque.chat.resources.RESPONSE_LETTER = ['response-letter:777'];
  assert.equal(await verifyChatData({ reference, input, data: opaque }), true);
  for (const mutate of [d => { d.chat.id = 556; }, d => { d.resources.resumes[222].hash = 'foreign'; },
    d => { d.resources.negotiation_topics[444].vacancyId = 124; },
    d => { d.resources.participants['applicant-1'].isCurrentUser = false; },
    d => { d.chat.messages.items[0].participantId = 'employer'; },
    d => { d.chat.messages.items[0].text += ' '; },
    d => { d.chat.messages.items[0].resources = { ...d.chat.resources, RESPONSE_LETTER: ['778'] }; },
    d => { d.chat.messages.items.push(structuredClone(d.chat.messages.items[0])); },
    d => { delete d.chat.messages.items[0].workflowTransition; },
    d => { d.chat.messages.items[0].hidden = true; },
  ]) {
    const data = fixture(); mutate(data);
    assert.equal(await verifyChatData({ reference, input, data }), false);
  }
});
test('bounded GET rejects another origin, oversized body and malformed JSON without returning content', async () => {
  const oldFetch = global.fetch, oldLocation = global.location;
  try {
    global.location = { origin: 'https://chatik.hh.ru', pathname: '/chat/555' };
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++; assert.equal(url, '/chatik/api/chat_data?chatId=555'); assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify(fixture()), { headers: { 'content-type': 'application/json' } });
    };
    assert.equal(await verifyChatData({ reference, input }), true);
    global.location.origin = 'https://attacker.invalid';
    assert.equal(await verifyChatData({ reference, input }), false); assert.equal(calls, 1);
    global.location.origin = 'https://chatik.hh.ru';
    global.fetch = async () => new Response('x'.repeat(1048577), { headers: { 'content-type': 'application/json' } });
    assert.equal(await verifyChatData({ reference, input }), false);
    global.fetch = async () => new Response('{', { headers: { 'content-type': 'application/json' } });
    assert.equal(await verifyChatData({ reference, input }), false);
  } finally { global.fetch = oldFetch; if (oldLocation === undefined) delete global.location; else global.location = oldLocation; }
});
