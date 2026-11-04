const test = require('node:test');
const assert = require('node:assert/strict');
const { JobApplicationService } = require('../src/jobs/jobApplicationService');

const input = { scope: {}, draftId: 'draft', automationRevision: 1 };
const cancelled = () => Object.assign(Error(), { code: 'JOB_AUTOMATION_UNAVAILABLE' });

test('automatic cancellation before claim is known only after excluding a previous operation', async () => {
  let previous = null;
  const service = new JobApplicationService({ repository: { async findAutomaticForDraft() { return previous; } } });
  service.submitAutomaticAttempt = async () => { throw cancelled(); };
  assert.deepEqual(await service.submitAutomatic(input), {
    status: 'cancelled', operationId: null, failureCode: 'JOB_AUTOMATION_UNAVAILABLE' });
  previous = { status: 'unknown', operation_id: 'original', failure_code: 'JOB_SUBMISSION_OUTCOME_UNKNOWN' };
  assert.deepEqual(await service.submitAutomatic(input), {
    status: 'unknown', operationId: 'original', failureCode: 'JOB_SUBMISSION_OUTCOME_UNKNOWN' });
});

test('a possibly committed claim or failed previous-operation lookup cannot become cancellation', async () => {
  const service = new JobApplicationService({ repository: { async findAutomaticForDraft() { throw Error('database'); } } });
  service.submitAutomaticAttempt = async () => { throw cancelled(); };
  await assert.rejects(service.submitAutomatic(input), /database/);
  service.submitAutomaticAttempt = async (_, checkpoint) => { checkpoint.claimAttempted = true; throw cancelled(); };
  await assert.rejects(service.submitAutomatic(input), { code: 'JOB_AUTOMATION_UNAVAILABLE' });
  service.submitAutomaticAttempt = async () => { throw Object.assign(Error(), { code: 'JOB_REVISION_CONFLICT' }); };
  await assert.rejects(service.submitAutomatic(input), { code: 'JOB_REVISION_CONFLICT' });
});
