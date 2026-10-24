const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');const {once}=require('node:events');
const {createRpcServer}=require('../../job-browser/src/rpcServer');
const {JobBrowserClient}=require('../src/jobs/jobBrowserClient');
const {normalizeHistory}=require('../../job-browser/src/hhHistoryReader');
const {historySchema}=require('../src/jobs/jobHistorySchema');
const {parseJobCallback}=require('../src/jobs/jobTelegramCallbacks');
const {validTarget}=require('../../job-browser/src/manualState');
const {targetUrl}=require('../../job-browser/src/captchaProtocol');
test('browser normalization and strict server wire schema agree without exporting private source data',()=>{
 const result=normalizeHistory({section:'active',total:1,pages:'1',topics:[{id:1,vacancyId:2,resumeId:3,lastState:'RESPONSE',initialState:'RESPONSE',viewedByOpponent:false,creationTimeMillis:1720000000000,privateText:'not exported'}],vacancies:[]},{section:'active',page:0});
 assert.deepEqual(historySchema.parse(result),result);assert.equal(JSON.stringify(result).includes('privateText'),false);
 assert.equal(historySchema.safeParse({...result,items:[{...result.items[0],url:'https://evil.example/'}]}).success,false);
 assert.equal(historySchema.safeParse({...result,privateChat:'not allowed'}).success,false);
});
test('history RPC uses only read auth, closed section/page and rejects malformed response data',async()=>{
 const ownerId=randomUUID(),token=randomBytes(32).toString('hex');let calls=0,extra=false;
 const rpc=createRpcServer({ownerId,token,browser:{async history({section,page}){calls++;return{section,page,pages:1,total:0,items:[],...(extra?{privateText:'not exported'}:{})};}}});rpc.listen(0,'127.0.0.1');await once(rpc,'listening');
 try{const client=new JobBrowserClient({ownerId,token,baseUrl:`http://127.0.0.1:${rpc.address().port}`,allowTestHttp:true});
 assert.deepEqual(await client.forUser(ownerId).history({section:'active',page:0}),{section:'active',page:0,pages:1,total:0,items:[]});
 for(const args of[{section:'all',page:0},{section:'active',page:-1},{section:'active',page:1000},{section:'active',page:0,url:'https://hh.ru'}])await assert.rejects(client.request(ownerId,'history',args));
 assert.equal(calls,1);assert.equal(client.forUser(randomUUID()).capabilities.dateWindows,true);
 assert.equal(client.forUser(randomUUID()).capabilities.dateWindowGranularity,'moscow_day');
 extra=true;await assert.rejects(client.forUser(ownerId).history({section:'archived',page:0}),{code:'JOB_HH_INVALID_RESPONSE'});
 }finally{await new Promise(r=>rpc.close(r));}
});
test('tracker callbacks stay within 64 bytes and CAPTCHA targets retain exact source binding',()=>{
 assert.equal(validTarget('https://hh.ru/applicant/resumes'),true);assert.ok(targetUrl('https://hh.ru/applicant/resumes'));
 assert.equal(validTarget('https://hh.ru/applicant/resumes?write=1'),false);assert.equal(targetUrl('https://hh.ru/applicant/resumes?write=1'),null);
 for(const action of['application','application_refresh']){const data=`job:${action}:${randomUUID()}`;assert.ok(Buffer.byteLength(data)<=64);assert.equal(parseJobCallback(data).action,action);}
 assert.equal(parseJobCallback('job:applications_sync').action,'applications_sync');
 assert.equal(parseJobCallback('job:application_refresh:foreign'),null);
 for(const section of['active','archived']){const url=`https://hh.ru/applicant/negotiations?filter=${section}&page=0`;assert.equal(validTarget(url),true);assert.ok(targetUrl(url));
  for(const bad of[url+'&extra=1',url.replace('hh.ru','evil.example'),url.replace('page=0','page=1000'),url+'#x']){assert.equal(validTarget(bad),false);assert.equal(targetUrl(bad),null);}}
});
