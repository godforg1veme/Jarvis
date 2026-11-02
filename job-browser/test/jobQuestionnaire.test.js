const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuestionnaire, normalizeAnswers } = require('../../shared/jobQuestionnaire');
const { validRequest } = require('../src/rpcProtocol');

const questions = [
  { id: 'experience', label: 'Какие проекты вы делали?', type: 'text', required: true, maxLength: 1000, options: [] },
  { id: 'technology', label: 'Работали с RAG?', type: 'single', required: true, maxLength: null,
    options: [{ id: 'yes', label: 'Да' }, { id: 'no', label: 'Нет' }] },
];
const questionnaire = normalizeQuestionnaire({ questions });
const answers = [{ id: 'technology', value: 'yes' }, { id: 'experience', value: 'Есть проект.' }];

test('questionnaire hashes canonical bounded prompts and answers', () => {
  assert.deepEqual(normalizeQuestionnaire(questionnaire), questionnaire);
  assert.deepEqual(normalizeAnswers(questionnaire, answers), [answers[1], answers[0]]);
  for (const altered of [
    { ...questionnaire, hash: '0'.repeat(64) },
    { questions: [questions[0], { ...questions[0] }] },
    { questions: [{ ...questions[0], label: 'x'.repeat(1001) }] },
    { questions: [{ ...questions[0], id: 'letter' }] },
    { questions: [{ ...questions[0], id: 'captchaAnswer' }] },
    { questions: [{ ...questions[0], id: 'question:one' }] },
    { questions: [{ ...questions[1], options: [{ id: 'yes', label: 'Да' }, { id: 'yes', label: 'Нет' }] }] },
    { questions: Array(21).fill(questions[0]) },
  ]) assert.throws(() => normalizeQuestionnaire(altered), { code: 'JOB_HH_INVALID_QUESTIONNAIRE' });
  for (const altered of [answers.slice(0, 1), [...answers, answers[0]],
    [{ id: 'experience', value: 'x'.repeat(1001) }, answers[0]],
    [{ id: 'experience', value: 'Есть проект.' }, { id: 'technology', value: 'maybe' }],
  ]) assert.throws(() => normalizeAnswers(questionnaire, altered), { code: 'JOB_HH_INVALID_ANSWERS' });
});

test('write RPC accepts only fully validated questionnaire answers', () => {
  const base = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operation: 'submit', args: {
    operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', externalId: '123', resumeId: 'fixture',
    letter: 'Текст письма', questionnaire, answers } };
  assert.equal(validRequest(base), true);
  assert.equal(validRequest({ ...base, args: { ...base.args, answers: answers.slice(0, 1) } }), false);
  assert.equal(validRequest({ ...base, args: { ...base.args, questionnaire: { ...questionnaire, hash: '0'.repeat(64) } } }), false);
});

test('multiple choice answers have a canonical distinct order and cannot invent options',()=>{
  const q=normalizeQuestionnaire({questions:[{...questions[1],type:'multiple'}]});
  assert.deepEqual(normalizeAnswers(q,[{id:'technology',value:['no','yes']}]),[{id:'technology',value:['yes','no']}]);
  for(const value of [[],['yes','yes'],['unknown'],'yes'])
    assert.throws(()=>normalizeAnswers(q,[{id:'technology',value}]),{code:'JOB_HH_INVALID_ANSWERS'});
});

test('native hash survives JSONB object key ordering',()=>{
  const canonical=normalizeQuestionnaire({native:{uidPk:'42',guid:'fixture-test',testRequired:true},
    questions:[{...questions[0],id:'task_8_text'}]});
  const fromDatabase={...canonical,native:{guid:'fixture-test',testRequired:true,uidPk:'42'}};
  assert.deepEqual(normalizeQuestionnaire(fromDatabase),canonical);
});
