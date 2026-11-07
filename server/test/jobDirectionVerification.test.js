const test = require('node:test');
const assert = require('node:assert/strict');
const { JobModelAdapter } = require('../src/jobs/jobModelAdapter');
const { buildDirectionVerificationPrompt } = require('../src/jobs/jobDirectionVerification');

const vacancy = { title: 'Сметчик-Расчётчик ИЖС',
  description: 'Составлять строительные сметы и рассчитывать материалы. Внедрение ИИ в сметный модуль для ускорения расчётов.' };
const settings = { queries: ['AI QA'] };
const selection = { vacancy, settings, profile: { facts: ['PRIVATE_FACT'] },
  resumeContext: { snapshot: { experience: 'PRIVATE_RESUME' } }, baseLetter: 'PRIVATE_LETTER' };

function decision({ apply, quote, primaryOccupation = 'Сметчик' }) {
  return { decision: apply ? 'apply' : 'skip', directionMatched: apply,
    reasonCode: apply ? 'DIRECTION_FIT' : 'OUT_OF_DIRECTION', rationale: 'Source duties',
    directionAssessment: { primaryOccupation, targetQuery: 'AI QA',
      relationship: apply ? 'core' : 'tool_only', dutiesQuotes: [quote] } };
}

test('independent direction prompt contains only public source and configured queries', () => {
  const messages = buildDirectionVerificationPrompt(selection);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  const data = JSON.parse(messages[1].content);
  assert.deepEqual(Object.keys(data).sort(), ['dutyEvidence', 'dutyEvidenceComplete', 'queries', 'vacancy']);
  assert.deepEqual(data.vacancy, vacancy);
  assert.deepEqual(data.queries, settings.queries);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_FACT|PRIVATE_RESUME|PRIVATE_LETTER/);
});

test('independent direction veto and grounded positive retain provider usage', async () => {
  const outcomes = [decision({ apply: false, quote: 'Составлять строительные сметы и рассчитывать материалы.' }),
    decision({ apply: true, quote: 'Тестировать ответы LLM-системы на точность и безопасность.',
      primaryOccupation: 'QA Engineer' })];
  const sent = [];
  const adapter = new JobModelAdapter({ config: { openrouterApiKey: 'test-key' },
    fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return Response.json({ id: `direction-${sent.length}`, model: 'z-ai/glm-5.3-flash',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outcomes.shift()) } }],
        usage: { cost: 0.002 } });
    } });
  const veto = await adapter.verifyDirection(selection);
  assert.equal(veto.decision, 'skip');
  assert.equal(veto.reasonCode, 'OUT_OF_DIRECTION');
  assert.equal(veto.usage.cost, 0.002);
  assert.equal(veto.requestId, 'direction-1');
  const aiVacancy = { title: 'QA Engineer', description: 'Тестировать ответы LLM-системы на точность и безопасность.' };
  const positive = await adapter.verifyDirection({ ...selection, vacancy: aiVacancy });
  assert.equal(positive.decision, 'apply');
  assert.equal(positive.directionAssessment.primaryOccupation, 'QA Engineer');
  for (const body of sent) {
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_FACT|PRIVATE_RESUME|PRIVATE_LETTER/);
    assert.deepEqual(body.response_format.json_schema.schema.properties.directionAssessment.properties.targetQuery.enum,
      ['AI QA', null]);
  }
});

test('invalid independent decision fails closed while retaining billable usage', async () => {
  const adapter = new JobModelAdapter({ config: { openrouterApiKey: 'test-key' },
    fetchImpl: async () => Response.json({ id: 'direction-invalid', model: 'z-ai/glm-5.3-flash',
      choices: [{ finish_reason: 'stop', message: { content: '{"decision":"apply"}' } }],
      usage: { cost: 0.003 } }) });
  await assert.rejects(adapter.verifyDirection(selection), error =>
    error.code === 'JOB_MODEL_INVALID_OUTPUT' && error.modelUsage.cost === 0.003
      && error.modelRequestId === 'direction-invalid');
});
