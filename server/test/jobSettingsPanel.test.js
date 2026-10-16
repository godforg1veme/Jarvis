const test = require('node:test');
const assert = require('node:assert/strict');
const { parseValue, fields, choices } = require('../src/jobs/jobSettingsControls');
const { parseJobCallback } = require('../src/jobs/jobTelegramCallbacks');
const { validateContext } = require('../src/telegram/telegramInteractionRepository');
const id = '12345678-1234-4234-8234-123456789abc';

test('one-field settings values respect existing ranges and ordinary Russian input', () => {
  assert.equal(parseValue('salary', '150 000'), 150000);
  assert.equal(parseValue('budget', '3,5'), 3.5);
  assert.equal(parseValue('interval', '60'), 3600000);
  assert.equal(parseValue('city', ' Казань '), 'Казань');
  assert.equal(parseValue('exclusions', 'X'), 'X');
  for (const [field, value] of [['salary','0'],['interval','1.5'],['history','31'],['budget','0'],['budget','1e3'],['model','Bearer private-fixture'],['queries','X'],['remote','да']]) {
    assert.throws(() => parseValue(field,value));
  }
  assert.equal(choices('model', {model:'fixture/current'}, ['fixture/default','fixture/current']).filter(x=>x.value==='fixture/current').length, 1);
  assert.equal(choices('model', {model:''}, [])[0].value, '');
});

test('settings callbacks are closed, bounded, revisioned and carry no user values', () => {
  assert.deepEqual(parseJobCallback('job:cfg:interval:2:0'), {action:'cfg',field:'interval',revision:2,page:0});
  for (const field of Object.keys(fields)) assert.ok(parseJobCallback(`job:cfg:${field}:2147483647:12`));
  assert.equal(parseJobCallback('job:cfg:password:2:0'),null);
  for (const x of ['job:cfg:salary:0:0','job:cfg:salary:1:13','job:cfg:salary:999999999999:0','job:cfg_pick:model:1:openrouter/private','job:cfg_item:city:1:0']) assert.equal(parseJobCallback(x),null);
  assert.ok(parseJobCallback(`job:cfg_ok:${id}`));
});

test('new guided kind has a closed context without expanding legacy job contexts', () => {
  const context={targetId:id,revision:1,field:'city',returnPage:0};
  assert.deepEqual(validateContext('job_setting_value',context),context);
  for (const input of [{...context,field:'remote'},{...context,field:'shell'},{...context,extra:1},{...context,returnPage:13}]) assert.throws(()=>validateContext('job_setting_value',input));
  assert.throws(()=>validateContext('job_profile_edit',context));
});
