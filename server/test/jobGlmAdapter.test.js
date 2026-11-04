const test = require('node:test');
const assert = require('node:assert/strict');
const { JobModelAdapter, JOB_MODEL, JOB_MODEL_PRICE_CAP, providerUsage } = require('../src/jobs/jobModelAdapter');
const { createJobRuntime } = require('../src/jobs/jobRuntime');

const input = { vacancy: { title:'Developer',description:'Build AI integrations and deploy retrieval systems.' },
  settings: { queries: ['AI Engineer'] },
  profile: {confirmed:false,facts:[],examples:[]}, resumeContext:{resumeId:'fixture',snapshot:{resumeId:'fixture',
    title:'Developer',experience:'Own integration project',skills:'Node.js',education:'Engineering',summary:'Automation',grammaticalGender:'unknown'}} };
const completion = (text, extra={}) => Response.json({id:'generation-fixture',model:JOB_MODEL,
  usage:{cost:0.001},choices:[{message:{content:text},finish_reason:'stop'}],...extra});

test('GLM uses existing OpenRouter key, fixed model, strict output, price sorting and bounded required reasoning',async()=>{
  let captured;
  const adapter=new JobModelAdapter({config:{openrouterApiKey:'fixture-key',openrouterModel:'other/model',jobDeepseekApiKey:'unused'},
    fetchImpl:async(url,init)=>{captured={url,init,body:JSON.parse(init.body)};return completion('{"text":"Letter","factIds":[]}');}});
  const result=await adapter.generate({messages:[{role:'user',content:'Write letter'}]});
  assert.equal(captured.url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(captured.init.headers.authorization,'Bearer fixture-key');
  assert.equal(captured.init.redirect,'error');
  assert.equal(captured.body.model,'z-ai/glm-5.3-flash');
  assert.equal(captured.body.models,undefined);assert.equal(captured.body.tools,undefined);
  assert.equal(captured.body.max_tokens,6000);
  assert.equal(captured.body.response_format.type,'json_schema');
  assert.equal(captured.body.response_format.json_schema.strict,true);
  assert.deepEqual(captured.body.reasoning,{effort:'low',exclude:true});
  assert.deepEqual(captured.body.provider,{sort:'price',require_parameters:true,allow_fallbacks:false,max_price:JOB_MODEL_PRICE_CAP});
  assert.equal(captured.body.usage.include,true);
  assert.deepEqual(result.usage,{cost:0.001,costBasis:'provider'});
  assert.equal(adapter.available,true);
});

test('GLM evaluation uses the same model/key and returns only the validated decision',async()=>{
  let body;
  const adapter=new JobModelAdapter({config:{openrouterApiKey:'fixture'},fetchImpl:async(url,init)=>{
    body=JSON.parse(init.body);return completion(JSON.stringify({ decision: 'apply',
      directionMatched: true, reasonCode: 'DIRECTION_FIT', rationale: 'Fixture direction matches',
      directionAssessment: { primaryOccupation: 'AI integration developer', targetQuery: 'AI Engineer',
        relationship: 'core', dutiesQuotes: ['Build AI integrations and deploy retrieval systems.'] } }));}});
  const result=await adapter.evaluate(input);
  assert.equal(body.model,JOB_MODEL);assert.equal(body.max_tokens,6000);
  assert.deepEqual(body.response_format.json_schema.schema.properties.decision.enum,['apply','skip']);
  assert.deepEqual(body.response_format.json_schema.schema.properties.reasonCode.enum,
    ['DIRECTION_FIT','OUT_OF_DIRECTION','INSUFFICIENT_FIT','MANDATORY_REQUIREMENT','USER_CONSTRAINT','UNCERTAIN']);
  const responseProperties = body.response_format.json_schema.schema.properties;
  assert.equal(responseProperties.rationale.maxLength, 240);
  assert.equal(responseProperties.directionAssessment.properties.primaryOccupation.maxLength, 120);
  assert.equal(responseProperties.directionAssessment.properties.targetQuery.maxLength, 200);
  assert.equal(responseProperties.directionAssessment.properties.dutiesQuotes.maxItems, 3);
  assert.equal(responseProperties.directionAssessment.properties.dutiesQuotes.items.maxLength, 240);
  assert.deepEqual(responseProperties.directionAssessment.properties.dutiesQuotes.items.enum,
    ['Build AI integrations and deploy retrieval systems.']);
  assert.deepEqual(responseProperties.directionAssessment.properties.targetQuery.enum, ['AI Engineer', null]);
  assert.deepEqual(body.response_format.json_schema.schema.properties.directionAssessment.properties.relationship.enum,
    ['core','tool_only','adjacent','unclear']);
  assert.deepEqual(body.response_format.json_schema.schema.required,
    ['decision','directionMatched','reasonCode','rationale','directionAssessment']);
  assert.deepEqual(JSON.parse(body.messages[1].content).selectedResume,input.resumeContext.snapshot);
  assert.equal(result.decision,'apply');assert.equal(result.reasonCode,'DIRECTION_FIT');
  assert.equal(result.directionAssessment.relationship,'core');
  assert.equal(result.usage.cost,0.001);
});

test('concurrent evaluations keep user queries and vacancy evidence isolated', async () => {
  const formats = [];
  const adapter = new JobModelAdapter({ config: { openrouterApiKey: 'fixture' }, fetchImpl: async (url, init) => {
    formats.push(JSON.parse(init.body).response_format.json_schema.schema.properties.directionAssessment.properties);
    return completion(JSON.stringify({ decision: 'skip', directionMatched: false,
      reasonCode: 'OUT_OF_DIRECTION', rationale: 'Other occupation', directionAssessment: {
        primaryOccupation: 'Other occupation', targetQuery: null,
        relationship: 'tool_only', dutiesQuotes: [] } }));
  } });
  await Promise.all([
    adapter.evaluate(input),
    adapter.evaluate({ ...input, vacancy: { title: 'Support', description: 'Maintain LDAP and Linux systems.' },
      settings: { queries: ['LLM Trainer'] } }),
  ]);
  assert.deepEqual(formats.map(f => f.targetQuery.enum), [['AI Engineer', null], ['LLM Trainer', null]]);
  assert.deepEqual(formats.map(f => f.dutiesQuotes.items.enum), [
    ['Build AI integrations and deploy retrieval systems.'], ['Maintain LDAP and Linux systems.'],
  ]);
});

test('a real core duty after the bounded candidate list can still authorize the decision', async () => {
  const duty = 'Build and deploy RAG agents as the main job.';
  const description = Array.from({ length: 96 }, (_, i) => `Company policy entry ${i} applies.`).join('\n')
    + `\n${duty}`;
  let body, calls = 0;
  const adapter = new JobModelAdapter({ config: { openrouterApiKey: 'fixture' }, fetchImpl: async (url, init) => {
    calls++; body = JSON.parse(init.body);
    return completion(JSON.stringify({ decision: 'apply', directionMatched: true, reasonCode: 'DIRECTION_FIT',
      rationale: 'The primary duty is after the company introduction.', directionAssessment: {
        primaryOccupation: 'AI Engineer', targetQuery: 'AI Engineer', relationship: 'core', dutiesQuotes: [duty],
      } }));
  } });
  const result = await adapter.evaluate({ ...input, vacancy: { title: 'Engineer', description } });
  const context = JSON.parse(body.messages[1].content);
  assert.equal(context.dutyEvidenceComplete, false);
  assert.equal(context.dutyEvidence.length, 96);
  assert.equal(context.dutyEvidence.includes(duty), true, 'the late duty is retained in the full-description sample');
  assert.equal(context.dutyEvidence.includes('Company policy entry 0 applies.'), true);
  assert.equal(context.vacancy.description, description);
  const quoteSchema = body.response_format.json_schema.schema.properties.directionAssessment.properties.dutiesQuotes;
  assert.equal(quoteSchema.items.enum, undefined);
  assert.equal(quoteSchema.items.minLength, 10);
  assert.equal(result.decision, 'apply');
  assert.deepEqual(result.directionAssessment.dutiesQuotes, [duty]);
  assert.equal(calls, 1);
});

test('missing cost stays unknown while zero cost remains a provider receipt',()=>{
  assert.deepEqual(providerUsage({cost:0}),{cost:0,costBasis:'provider'});
  for(const value of [{},{cost:'0.01'},{cost:-1},{cost:NaN},null])
    assert.deepEqual(providerUsage(value),{cost:null,costBasis:'unknown'});
});

test('invalid or truncated billed outputs preserve original cost and request ID',async()=>{
  for(const output of [completion('{"decision":"apply","explanation":"extra"}'),
    completion('',{choices:[{message:{content:null},finish_reason:'length'}]}),
    completion('{"decision":"apply"}',{model:'different/model'})]){
    let calls=0;
    const adapter=new JobModelAdapter({config:{openrouterApiKey:'fixture'},fetchImpl:async()=>{calls++;return output;}});
    await assert.rejects(adapter.evaluate(input),e=>e.code==='JOB_MODEL_INVALID_OUTPUT'
      &&e.modelUsage.cost===0.001&&e.modelUsage.costBasis==='provider'&&e.modelRequestId==='generation-fixture');
    assert.equal(calls,1);
  }
});

test('provider failures never retry, change model or reveal remote error text',async()=>{
  for(const status of [400,401,402,429,503]){
    let calls=0;
    const adapter=new JobModelAdapter({config:{openrouterApiKey:'fixture'},fetchImpl:async()=>{
      calls++;return new Response('private upstream diagnostic',{status});}});
    await assert.rejects(adapter.generate({messages:[]}),{message:'JOB_MODEL_UNAVAILABLE'});
    assert.equal(calls,1);
  }
});

test('OpenRouter key is required and a direct DeepSeek key cannot silently select another provider',async()=>{
  let calls=0;
  const adapter=new JobModelAdapter({config:{jobDeepseekApiKey:'not-used'},fetchImpl:async()=>{calls++;}});
  assert.equal(adapter.available,false);
  await assert.rejects(adapter.generate({messages:[]}),{code:'JOB_MODEL_NOT_CONFIGURED'});
  assert.equal(calls,0);
});

test('OpenRouter alone enables the personal automation service when HH prerequisites are configured',async()=>{
  const runtime=createJobRuntime({config:{jobSearchEnabled:true,openrouterApiKey:'fixture',
    jobBrowserOwnerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jobBrowserToken:'r'.repeat(32),
    jobBrowserApplyEnabled:true,jobBrowserApplyToken:'w'.repeat(32)},pool:{}});
  assert.equal(runtime.automationService.available,true);
  await runtime.close();
});
