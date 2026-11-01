const test = require('node:test');
const assert = require('node:assert/strict');
const { JobModelAdapter, JOB_MODEL, JOB_MODEL_PRICE_CAP, providerUsage } = require('../src/jobs/jobModelAdapter');
const { createJobRuntime } = require('../src/jobs/jobRuntime');

const input = { vacancy: { title:'Developer',description:'Related project experience welcome' },
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
    body=JSON.parse(init.body);return completion('{"decision":"apply"}');}});
  const result=await adapter.evaluate(input);
  assert.equal(body.model,JOB_MODEL);assert.equal(body.max_tokens,1024);
  assert.deepEqual(body.response_format.json_schema.schema.properties.decision.enum,['apply','skip']);
  assert.deepEqual(JSON.parse(body.messages[1].content).selectedResume,input.resumeContext.snapshot);
  assert.equal(result.decision,'apply');assert.equal(result.usage.cost,0.001);
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
