const test = require('node:test');
const assert = require('node:assert/strict');
const { FamilyAccessService } = require('../src/life/people/familyAccessService');
const { FAMILY_PERMISSIONS } = require('../src/life/people/peopleSchemas');
const { EVENT_CATEGORY_IDS } = require('../src/life/people/familyAccessPolicy');

const OWNER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const RESOURCE = '33333333-3333-4333-8333-333333333333';

test('every family permission is checked against an active exact grant', async () => {
  const calls = [];
  const service = new FamilyAccessService({
    repository: { async findActiveGrant(input) { calls.push(input); return input.resourceId === RESOURCE ? { id: 'grant' } : null; } },
    now: () => new Date('2026-09-14T12:00:00.000Z'),
  });
  for (const permission of FAMILY_PERMISSIONS) assert.equal(await service.authorize({
    userId: OWNER, memberUserId: MEMBER, resourceType: 'project', resourceId: RESOURCE, permission,
  }), true);
  assert.equal(await service.authorize({
    userId: OWNER, memberUserId: MEMBER, resourceType: 'project', resourceId: OWNER, permission: 'view_summary',
  }), false);
  assert.equal(calls.every((call) => call.userId === OWNER && call.memberUserId === MEMBER), true);
});

test('shared family output contains safe summaries but no grantor, document, or device authority', async () => {
  const service = new FamilyAccessService({ repository: { async listSharedSummaries({ memberUserId }) {
    assert.equal(memberUserId, MEMBER);
    return [
      { grant_id: 'grant-a', resource_type: 'project', permission: 'view_summary', label: 'Life OS', summary: 'Семейный проект' },
      { grant_id: 'grant-b', resource_type: 'event_category', resource_id: EVENT_CATEGORY_IDS.family, permission: 'view_summary', label: null, summary: '' },
    ];
  } } });
  const shared = await service.listShared({ memberUserId: MEMBER });
  assert.equal(shared[1].label, 'family');
  const serialized = JSON.stringify(shared);
  assert.doesNotMatch(serialized, /userId|document|device|path|token|credential/iu);
});

test('grant creation and revocation stay owner-scoped and revision-bound', async () => {
  const calls = [];
  const events = [];
  const repository = {
    async createFamilyGrant(input) { calls.push(input); return { id: RESOURCE, user_id: OWNER, member_user_id: MEMBER, resource_type: 'project', resource_id: RESOURCE, permission: 'view_summary', revision: 1 }; },
    async revokeFamilyGrant(input) { calls.push(input); return { id: RESOURCE, user_id: OWNER, member_user_id: MEMBER, resource_type: 'project', resource_id: RESOURCE, permission: 'view_summary', revision: 2 }; },
  };
  const service = new FamilyAccessService({ repository, gateway: { async record(event) { events.push(event); } } });
  await service.create({ userId: OWNER, input: { memberUserId: MEMBER, resourceType: 'project', resourceId: RESOURCE, permission: 'view_summary' } });
  await service.revoke({ userId: OWNER, grantId: RESOURCE, revision: 1 });
  assert.equal(calls.every((call) => call.userId === OWNER), true);
  assert.deepEqual(events.map((event) => event.eventType), ['family_access.granted', 'family_access.revoked']);
});
