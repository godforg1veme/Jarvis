const test = require('node:test');
const assert = require('node:assert/strict');
const { generateLetter, repairRequestId } = require('../src/jobs/jobLetterGeneration');
const { JOB_LETTER_RESPONSE_FORMAT, parseJobLetter } = require('../src/jobs/jobPrompt');
function harness(replies, allowRepair = true) {
  const calls = [], options = { messages: [{ role: 'system', content: 'Contract' }], profile: { facts: [] },
    requestId: 'auto-letter:fixture', allowRepair,
    beforeCall: async x => { calls.push(['checkpoint', x.usageId]); },
    invoke: async () => { calls.push(['invoke']); const r = replies.shift(); if (r instanceof Error) throw r; return r; },
    record: async x => { calls.push(['usage', x.usageId]); },
  }; return { calls, options };
}
const valid = () => ({ text: JSON.stringify({ status: 'ready', text: 'Письмо.', factIds: [] }), finishReason: 'stop' });
test('one conclusive invalid reply repairs once with distinct deterministic cost identity', async () => {
  const h = harness([{ text: '{}', finishReason: 'stop' }, valid()]);
  assert.deepEqual(await generateLetter(h.options), { text: 'Письмо.', factIds: [] });
  assert.deepEqual(h.calls.map(c => c[0]), ['checkpoint','invoke','usage','checkpoint','invoke','usage']);
  assert.equal(h.calls[3][1], repairRequestId(h.options.requestId));
  assert.notEqual(h.calls[0][1], h.calls[3][1]);
});
test('two invalid replies hand off; unknown provider or lost repair checkpoint never invokes again', async () => {
  const h = harness([{ text: '{}'}, { text: '{}'}]);
  await assert.rejects(generateLetter(h.options), { code: 'JOB_LETTER_VALIDATION_FAILED' });
  assert.equal(h.calls.filter(c => c[0] === 'invoke').length, 2);
  const transport = harness([Object.assign(Error(), { code: 'JOB_MODEL_UNAVAILABLE' }), valid()]);
  await assert.rejects(generateLetter(transport.options), { code: 'JOB_MODEL_UNAVAILABLE' });
  assert.equal(transport.calls.filter(c => c[0] === 'invoke').length, 1);
  const checkpoint = harness([{ text: '{}'}, valid()]);
  checkpoint.options.beforeCall = async ({ attempt }) => { if (attempt) throw Object.assign(Error(), { code: 'JOB_GENERATION_OUTCOME_UNKNOWN' }); };
  await assert.rejects(generateLetter(checkpoint.options), { code: 'JOB_GENERATION_OUTCOME_UNKNOWN' });
  assert.equal(checkpoint.calls.filter(c => c[0] === 'invoke').length, 1);
});
test('missing applicant information never repairs; manual requests retain one-call behavior', async () => {
  const h = harness([{ text: JSON.stringify({ status: 'needs_applicant_answer', text: '', factIds: [] }) }, valid()]);
  await assert.rejects(generateLetter(h.options), { code: 'JOB_APPLICANT_ANSWER_REQUIRED' });
  assert.equal(h.calls.filter(c => c[0] === 'invoke').length, 1);
  const manual = harness([{ text: '{}' }, valid()], false);
  await assert.rejects(generateLetter(manual.options), { code: 'JOB_MODEL_INVALID_OUTPUT' });
  assert.equal(manual.calls.filter(c => c[0] === 'invoke').length, 1);
  const p = JOB_LETTER_RESPONSE_FORMAT.json_schema.schema.properties;
  assert.equal(p.text.maxLength, 10000); assert.equal(p.factIds.maxItems, 80); assert.equal(p.factIds.items.maxLength, 40);
});

test('local letter bounds report only closed fields without leaking the rejected text', () => {
  for (const [field, value] of [['text', 'x'.repeat(10001)], ['factIds', Array(81).fill('id')], ['factIds', ['x'.repeat(41)]]]) {
    const reply = { status: 'ready', text: 'Approved', factIds: [], [field]: value };
    assert.throws(() => parseJobLetter(JSON.stringify(reply), { facts: [] }), error => {
      assert.equal(error.code, 'JOB_MODEL_INVALID_OUTPUT'); assert.equal(error.validationReason, 'schema');
      assert.equal(error.validationField, field); assert.ok(!error.message.includes('Approved')); return true;
    });
  }
});
