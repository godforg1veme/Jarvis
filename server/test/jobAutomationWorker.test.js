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
    async saveEvaluation(value) { calls.push(['evaluation', value.evaluation]); return { id: value.itemId }; },
    async finalizeKnownSkip(value) { calls.push(['update', 'skipped', value.evaluatedSearchRevision]); return { searchRevisionChanged: false }; },
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
      async getSettings() { return { revision: 1, settings: { budgetUsd: 2, queries: ['integration developer'] } }; },
      async getVacancy() { return { id: VACANCY, revision: 1, snapshot: {
        title: 'Integration developer', description: 'Build integrations for internal services.', archived: false } }; },
    },
    profileRepository: { async ensure() { return { revision: 1, profile: { confirmed: true,
      baseLetter: 'I build integrations', facts: [], examples: [] } }; } },
    resumeContextService: { async getSelected() { return resumeContext; } },
    modelAdapter: { async evaluate(input) {
      calls.push(['evaluate', input.resumeContext.snapshot.experience]);
      return { decision, directionMatched: true,
        reasonCode: decision === 'apply' ? 'DIRECTION_FIT' : 'INSUFFICIENT_FIT',
        directionAssessment: { primaryOccupation: 'Integration developer', targetQuery: 'integration developer',
          relationship: 'core', dutiesQuotes: ['Build integrations for internal services.'] },
        rationale: 'Fixture role considered', usage: { cost: 0.001 }, requestId: 'model-1' };
    } },
    draftService: { async generate(input) { calls.push(['draft', input.requestId, input.sourceText]);
      return { id: DRAFT, text: 'My personal AI project is relevant.' }; } },
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

test('a current hard exclusion stops before model expense and submission', async () => {
  const { worker, item, calls } = harness('apply');
  worker.searchRepository.getSettings = async () => ({ revision: 2,
    settings: { budgetUsd: 2, queries: ['developer'], exclusions: ['real estate'] } });
  worker.searchRepository.getVacancy = async () => ({ revision: 1, filter_revision: 2,
    snapshot: { title: 'Real estate sales', description: 'Uses AI', archived: false } });
  await worker.process(item);
  assert.ok(calls.some(x => x[0] === 'evaluation' && x[1].reasonCode === 'USER_CONSTRAINT'));
  assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'skipped'));
  assert.deepEqual(calls.filter(x => ['usage','evaluate','draft','submit'].includes(x[0])), []);
});

test('transferable experience may be applied and a test hands off to the owner', async () => {
  const { worker, item, calls } = harness('apply', 'manual_required');
  await worker.process(item);
  assert.ok(calls.some(x => x[0] === 'evaluate' && x[1] === 'Personal desktop AI project'));
  assert.ok(calls.some(x => x[0] === 'submit' && x[1] === 2));
  assert.ok(calls.some(x => x[0] === 'draft' && x[2] === 'I build integrations'));
  assert.ok(calls.some(x => x[0] === 'evaluation' && x[1].directionMatched === true));
  assert.deepEqual(calls.filter(x => x[0] === 'attention'), [['attention','MANUAL_REQUIRED']]);
});

test('revoked consent prevents model expense and application', async () => {
  const { worker, item, calls } = harness('apply');
  worker.automationService.assertCurrent = async () => { throw Object.assign(new Error('revoked'), { code: 'JOB_AUTOMATION_UNAVAILABLE' }); };
  await worker.process(item);
  assert.deepEqual(calls.filter(x => ['usage','evaluate','draft','submit'].includes(x[0])), []);
  assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'failed'));
});

test('a search revision changed during evaluation cannot create a letter from the stale decision', async () => {
  const {worker,item,calls}=harness('apply');
  let revision=1;
  worker.searchRepository.getSettings=async()=>({revision,settings:{budgetUsd:2}});
  const evaluate=worker.modelAdapter.evaluate;
  worker.modelAdapter.evaluate=async input=>{const value=await evaluate(input);revision=2;return value;};
  await worker.process(item);
  assert.equal(calls.some(call=>['draft','submit'].includes(call[0])),false);
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

test('unknown required personal answer hands off without a draft or submit', async () => {
  const { worker, item, calls } = harness('apply');
  worker.draftService.generate = async () => { throw Object.assign(new Error('needs answer'),
    { code: 'JOB_APPLICANT_ANSWER_REQUIRED' }); };
  await worker.process(item);
  assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'manual_required'));
  assert.deepEqual(calls.filter(x => x[0] === 'attention'), [['attention','MANUAL_REQUIRED']]);
  assert.ok(!calls.some(x => x[0] === 'submit'));
});

test('invented first-person career commitment stops before submit', async () => {
  const { worker, item, calls } = harness('apply');
  worker.draftService.generate = async () => ({ id: DRAFT,
    text: 'Рассматриваю недвижимость как основную профессию.' });
  await worker.process(item);
  assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'manual_required'));
  assert.ok(!calls.some(x => x[0] === 'submit'));
});

test('incidental AI tools cannot authorize a letter even when an adapter returns apply', async () => {
  for (const [occupation, description] of [
    ['Real estate sales', 'Sell apartments and close property deals. Use AI tools to write client messages.'],
    ['Technical support', 'Configure LDAP, Jira, office PCs and Linux servers. Use AI tools to diagnose incidents.'],
    ['Cardiology sales', 'Visit doctors and promote pharmaceutical products. Use AI to prepare reports.'],
  ]) {
    const { worker, item, calls } = harness('apply');
    worker.searchRepository.getSettings = async () => ({ revision: 1, settings: { queries: ['AI engineer'] } });
    worker.searchRepository.getVacancy = async () => ({ revision: 1,
      snapshot: { title: occupation, description, archived: false } });
    worker.modelAdapter.evaluate = async () => ({ decision: 'apply', directionMatched: true,
      reasonCode: 'DIRECTION_FIT', rationale: 'Transferable client support experience and AI tools',
      directionAssessment: { primaryOccupation: occupation, targetQuery: 'AI engineer',
        relationship: 'tool_only', dutiesQuotes: [description.split('. ')[0] + '.'] },
      usage: { cost: 0.001 }, requestId: 'fixture-billed' });
    await worker.process(item);
    const saved = calls.find(x => x[0] === 'evaluation')?.[1];
    assert.equal(saved?.decision, 'skip');
    assert.equal(saved.reasonCode, 'OUT_OF_DIRECTION');
    assert.equal(saved.selectionPolicyVersion, 2);
    assert.equal(saved.directionAssessment.relationship, 'tool_only');
    assert.ok(calls.some(x => x[0] === 'usage' && x[1] === 'success'));
    assert.ok(calls.some(x => x[0] === 'update' && x[1] === 'skipped'));
    assert.equal(calls.some(x => ['draft', 'submit', 'backoff', 'attention'].includes(x[0])), false);
  }
});

test('fabricated duty or unrelated search direction becomes a known skip before the letter', async () => {
  for (const mismatch of ['quote', 'query']) {
    const { worker, item, calls } = harness('apply');
    worker.modelAdapter.evaluate = async () => ({ decision: 'apply', directionMatched: true,
      reasonCode: 'DIRECTION_FIT', rationale: 'Fixture direction', directionAssessment: {
        primaryOccupation: 'Integration developer', relationship: 'core',
        targetQuery: mismatch === 'query' ? 'property sales' : 'integration developer',
        dutiesQuotes: [mismatch === 'quote' ? 'Build RAG agents that are absent from the vacancy.'
          : 'Build integrations for internal services.'],
      }, usage: { cost: 0.001 }, requestId: 'fixture-billed' });
    await worker.process(item);
    const saved = calls.find(x => x[0] === 'evaluation')?.[1];
    assert.equal(saved?.decision, 'skip');
    assert.equal(saved.reasonCode, 'UNCERTAIN');
    assert.equal(saved.directionAssessment.relationship, 'unclear');
    assert.equal(calls.some(x => ['draft', 'submit', 'backoff', 'attention'].includes(x[0])), false);
  }
});

test('grounded selection evidence is stored before any letter or submission', async () => {
  const { worker, item, calls } = harness('apply');
  await worker.process(item);
  const index = calls.findIndex(x => x[0] === 'evaluation');
  assert.ok(index >= 0 && index < calls.findIndex(x => x[0] === 'draft'));
  assert.equal(calls[index][1].selectionPolicyVersion, 2);
  assert.deepEqual(calls[index][1].directionAssessment.dutiesQuotes, ['Build integrations for internal services.']);
  assert.ok(calls.some(x => x[0] === 'submit'));
});
