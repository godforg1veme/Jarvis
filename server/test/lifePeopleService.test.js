const test = require('node:test');
const assert = require('node:assert/strict');
const { PeopleService } = require('../src/life/people/peopleService');
const { LifeEnrichmentService } = require('../src/life/lifeEnrichmentService');

const USER = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

test('people operations pass owner scope and emit metadata-only lifecycle events', async () => {
  const calls = [];
  const events = [];
  const repository = {
    async listPeople(input) { calls.push(input); return []; },
    async createPerson(input) { calls.push(input); return { id: PERSON, display_name: input.displayName, status: 'active', revision: 1 }; },
    async updatePerson(input) { calls.push(input); return { id: PERSON, status: input.status || 'active', revision: 2 }; },
    async createRelationship(input) { calls.push(input); return { id: PERSON, person_id: input.personId, revision: 1 }; },
  };
  const service = new PeopleService({ repository, gateway: { async record(event) { events.push(event); } } });
  await service.list({ userId: USER });
  await service.create({ userId: USER, input: { displayName: 'Анна' } });
  await service.update({ userId: USER, personId: PERSON, input: { revision: 1, status: 'archived' } });
  await service.createRelationship({ userId: USER, input: { personId: PERSON, relationType: 'family.sister' } });
  assert.equal(calls.every((call) => call.userId === USER), true);
  assert.deepEqual(events.map((event) => event.eventType), ['person.created', 'person.archived', 'relationship.updated']);
  assert.equal(JSON.stringify(events).includes('notes'), false);
});

test('a linked person is carried into a detected commitment', async () => {
  let commitmentInput = null;
  const service = new LifeEnrichmentService({
    linker: { async link() { return { person: { id: PERSON } }; } },
    commitmentDetector: { async detect() { return { title: 'Позвонить Анне', dueAt: null, confidence: 1 }; } },
    repository: { async createCommitment(input) { commitmentInput = input; return { id: PERSON, title: input.title, confidence: 1 }; } },
    gateway: { async record() {} },
  });
  await service.enrich({ id: PERSON, user_id: USER, event_type: 'message.received' });
  assert.equal(commitmentInput.personId, PERSON);
  assert.equal(commitmentInput.userId, USER);
});
