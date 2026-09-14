const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonLinker } = require('../src/life/people/personLinker');

const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const ANNA = '33333333-3333-4333-8333-333333333333';

test('explicit names and aliases create only an owner-scoped person link', async () => {
  const calls = [];
  const linker = new PersonLinker({
    peopleRepository: { async listPeople(input) { calls.push(input); return [{ id: ANNA, display_name: 'Анна Петрова', aliases: ['Аня'] }]; } },
    projectionRepository: { async createLink(input) { calls.push(input); return { id: EVENT }; } },
  });
  const result = await linker.link({ id: EVENT, user_id: USER, summary: 'Завтра встреча, Аня поможет по проекту' });
  assert.equal(result.person.id, ANNA);
  assert.equal(calls[1].userId, USER);
  assert.equal(calls[1].targetType, 'person');
  assert.equal(calls[1].origin, 'trusted');
});

test('same-name ambiguity remains unresolved and does not invoke model ranking', async () => {
  let classified = 0;
  let persisted = 0;
  const linker = new PersonLinker({
    peopleRepository: { async listPeople() { return [
      { id: ANNA, display_name: 'Саша', aliases: [] },
      { id: EVENT, display_name: 'Саша', aliases: [] },
    ]; } },
    projectionRepository: { async createLink() { persisted += 1; } },
    classify: async () => { classified += 1; return { personId: ANNA, confidence: 1 }; },
  });
  const result = await linker.link({ id: EVENT, user_id: USER, summary: 'Саша участвует' });
  assert.equal(result.ambiguous, true);
  assert.equal(classified, 0);
  assert.equal(persisted, 0);
});

test('model-assisted selection can choose only a same-owner candidate', async () => {
  let persisted = 0;
  const linker = new PersonLinker({
    peopleRepository: { async listPeople() { return [{ id: ANNA, display_name: 'Анна', aliases: [] }]; } },
    projectionRepository: { async createLink() { persisted += 1; } },
    classify: async () => ({ personId: '99999999-9999-4999-8999-999999999999', confidence: 1 }),
  });
  assert.equal(await linker.link({ id: EVENT, user_id: USER, summary: 'Свяжи это с коллегой' }), null);
  assert.equal(persisted, 0);
});
