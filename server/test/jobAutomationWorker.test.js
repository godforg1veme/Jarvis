const test = require('node:test');
const assert = require('node:assert/strict');
const { JobAutomationWorker } = require('../src/jobs/jobAutomationWorker');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONVERSATION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VACANCY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ITEM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DRAFT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const resumeContext = { resumeId: 'one', connectionRevision: 4,
  snapshot: { resumeId: 'one', title: 'Developer', experience: 'Personal desktop AI project',
    skills: 'Node.js', education: '', summary: '', grammaticalGender: 'unknown' } };

function harness(decision, applicationStatus = 'sent') {
  const calls = [];
  const item = { id: ITEM, user_id: USER, vacancy_id: VACANCY, automation_revision: 2,
    conversation_id: CONVERSATION, chat_id: '123', evaluation_request_id: `auto-evaluate:${ITEM}`,
    draft_request_id: `auto-letter:${ITEM}` };
  const repository = {
    async claimCandidate() { return item; },
    async update(value) { calls.push(['update', value.status]); return { status: value.status }; },
    async enqueueAttention(value) { calls.push(['attention', value.code]); },
    async backoff() { calls.push(['backoff']); },
  };
  const worker = new JobAutomationWorker({
    pool: { async query(sql) {
      if (sql.includes('FROM conversations')) return { rowCount: 1, rows: [{ id: CONVERSATION }] };
      if (sql.includes('FROM job_applications')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    } }, repository,
    accessService: { repository: { async get() { return { blocked: false, permissions: ['jobs'] }; } } },
    automationService: { async assertCurrent() { calls.push(['consent']); } },
    searchRepository: {
      async getSettings() { return { settings: { budgetUsd: 2 } }; },
      async getVacancy() { return { id: VACANCY, revision: 1, snapshot: {
        title: 'Adjacent role', description: 'Need transferable skills', archived: false } }; },
    },
    profileRepository: { async ensure() { return { revision: 1, profile: { confirmed: true, facts: [], examples: [] } }; } },
    resumeContextService: { async getSelected() { return resumeContext; } },
    modelAdapter: { async evaluate(input) {
      calls.push(['evaluate', input.resumeContext.snapshot.experience]);
      return { decision, usage: { cost: 0.001 }, requestId: 'model-1' };
    } },
    draftService: { async generate(input) { calls.push(['draft', input.requestId]); return { id: DRAFT }; } },
    applicationService: { async submitAutomatic(input) {
      calls.push(['submit', input.automationRevision]); return { status: applicationStatus, operationId: null };
    } },
    usageRepository: {
      async record(input) { calls.push(['usage', input.outcome]); },
      async claimBudgetNotice() { calls.push(['notice']); },
    },
  });
  return { worker, item, calls };
}

test('a rejected vacancy stays silent and never prepares an application', async () => {
  const { worker, item, calls } = harness('skip');
  await worker.process(item);
  assert.deepEqual(calls.filter(x => ['draft','submit','attention'].includes(x[0])), []);
  assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'skipped'));
});

test('transferable experience may be applied and a test hands off to the owner', async () => {
  const { worker, item, calls } = harness('apply', 'manual_required');
  await worker.process(item);
  assert.ok(calls.some(x => x[0] === 'evaluate' && x[1] === 'Personal desktop AI project'));
  assert.ok(calls.some(x => x[0] === 'submit' && x[1] === 2));
  assert.deepEqual(calls.filter(x => x[0] === 'attention'), [['attention','MANUAL_REQUIRED']]);
});

test('revoked consent prevents model expense and application', async () => {
  const { worker, item, calls } = harness('apply');
  worker.automationService.assertCurrent = async () => { throw Object.assign(new Error('revoked'), { code: 'JOB_AUTOMATION_UNAVAILABLE' }); };
  await worker.process(item);
  assert.deepEqual(calls.filter(x => ['usage','evaluate','draft','submit'].includes(x[0])), []);
  assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'failed'));
});

test('a resume read failure before model invocation waits safely and can resume', async () => {
  const {worker,item,calls}=harness('apply');
  worker.resumeContextService.getSelected=async()=>{throw Object.assign(new Error('unavailable'),{code:'JOB_HH_RESUME_UNAVAILABLE'});};
  await worker.process(item);
  assert.ok(calls.some(x=>x[0]==='update'&&x[1]==='pending'));
  assert.ok(calls.some(x=>x[0]==='backoff'));
  assert.ok(!calls.some(x=>['usage','evaluate','draft','submit'].includes(x[0])));
});

test('an interrupted model or draft never claims that an application was submitted', async () => {
  const {worker,item,calls}=harness('apply');
  worker.draftService.generate=async()=>{throw new Error('synthetic failure');};
  await worker.process(item);
  assert.ok(calls.some(x=>x[0]==='update'&&x[1]==='unknown'));
  assert.deepEqual(calls.filter(x=>x[0]==='attention'),[['attention','PROCESSING_UNKNOWN']]);
  assert.ok(!calls.some(x=>x[0]==='submit'));
});
