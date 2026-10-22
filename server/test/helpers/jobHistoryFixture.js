const {randomBytes}=require('node:crypto');
const {once}=require('node:events');
const {createJobPostgresFixture}=require('./jobPostgresFixture');
const {createRpcServer}=require('../../../job-browser/src/rpcServer');
const {createJobRuntime}=require('../../src/jobs/jobRuntime');
const {TelegramInteractionRepository}=require('../../src/telegram/telegramInteractionRepository');
const {TelegramMenuService}=require('../../src/telegram/telegramMenuService');
const {TelegramMessageService}=require('../../src/telegram/messageService');
const {TelegramUpdateRepository}=require('../../src/telegram/telegramUpdateRepository');
const {UserRepository}=require('../../src/users/userRepository');
const {ConversationRepository}=require('../../src/conversations/conversationRepository');
const {createTelegramAccessPolicy}=require('../../src/telegram/accessPolicy');
const {JobSearchRepository}=require('../../src/jobs/jobSearchRepository');
const {telegramReplyMarkup}=require('../../src/telegram/bot');
function historyItem(topic='11',extra={}){return{topicId:topic,vacancyId:'123',resumeId:'456',resumeHash:null,resumeTitle:null,
 title:'Fixture vacancy',company:'Fixture company',url:'https://hh.ru/vacancy/123',appliedAt:'2026-10-01T12:00:00.000Z',status:'viewed',archived:false,...extra};}
function historyPage(section='active',items=[historyItem()],extra={}){return{section,page:0,pages:1,total:items.length,items,...extra};}
async function historyFixture(){
 const f=await createJobPostgresFixture();let updateId=100,reads=0,submits=0,modelCalls=0,failCode=null;
 await f.pool.query("INSERT INTO user_identities(user_id,provider,external_id) VALUES($1,'telegram','101'),($2,'telegram','202')",[f.owner,f.stranger]);
 await f.pool.query("INSERT INTO job_connections(user_id,resume_id,status) VALUES($1,'fixtureResume','connected')",[f.owner]);
 const token=randomBytes(32).toString('hex');const pages=new Map([['active:0',historyPage()],['archived:0',historyPage('archived',[])]]);
 const rpc=createRpcServer({ownerId:f.owner,token,browser:{async history({section,page}){reads++;if(failCode)throw Object.assign(Error('Fixture private failure'),{code:failCode});return structuredClone(pages.get(`${section}:${page}`));}}});
 rpc.listen(0,'127.0.0.1');await once(rpc,'listening');
 const interactions=new TelegramInteractionRepository(f.pool),clock={now:new Date('2026-10-16T12:00:00Z')};
 const runtime=createJobRuntime({config:{jobSearchEnabled:true,operationsOwnerTelegramId:'101',jobBrowserOwnerId:f.owner,jobBrowserToken:token,jobBrowserUrl:'http://job-browser:8080'},pool:f.pool,interactions,
 fetchImpl:(url,init)=>{if(url!=='http://job-browser:8080/rpc'){modelCalls++;throw Error('No model expected');}return fetch(`http://127.0.0.1:${rpc.address().port}/rpc`,init);},
 send:async()=>{throw Error('No outbound notification expected');},applicationAdapter:{capabilities:{applicantApply:true},async submit(){submits++;return{outcome:'unknown'};},async reconcile(){return{outcome:'unknown'};}}});
 runtime.historySync.now=()=>clock.now;
 const menu=new TelegramMenuService({interactions,jobSearchService:runtime.telegramService});
 const messages=new TelegramMessageService({accessPolicy:createTelegramAccessPolicy(['101','202']),updateRepository:new TelegramUpdateRepository(f.pool),
 userRepository:new UserRepository(f.pool),conversationRepository:new ConversationRepository(f.pool),menuService:menu,assistant:{async answer(){return'Fixture conversation';}}});
 const callbackUpdate=(data,from=101,chat=from,type='private')=>({update_id:++updateId,callback_query:{id:String(updateId),from:{id:from},data,message:{message_id:updateId,chat:{id:chat,type}}}});
 const cb=async(...args)=>{const result=await messages.handleCallback(callbackUpdate(...args));if(result.buttons)telegramReplyMarkup(result.buttons);return result;};
 const tick=async()=>{clock.now=new Date(clock.now.getTime()+2000);await runtime.historyWorker.tick();};
 const ownOperation=async(v,status,externalId=null,text='Private approved text')=>{
  await new JobSearchRepository(f.pool,{accessService:runtime.telegramService.accessService}).recordMatch({userId:f.owner,vacancyId:v.id,filterRevision:1});
  const draft=await runtime.telegramService.draftService.createManual({scope:f.scope,vacancyId:v.id,mode:'custom',text});
  const confirmation=await runtime.applicationRepository.prepare({scope:f.scope,draftId:draft.id});
  const claimed=await runtime.applicationRepository.claim({scope:f.scope,confirmationId:confirmation.id});
  return runtime.applicationRepository.finish({userId:f.owner,operationId:claimed.operation.operation_id,status,externalId});
 };
 return{...f,runtime,pages,clock,cb,callbackUpdate,messages,tick,ownOperation,setFailure:code=>{failCode=code;},get reads(){return reads;},get submits(){return submits;},get modelCalls(){return modelCalls;},
 async close(){await runtime.close();await new Promise(r=>rpc.close(r));await f.close();}};
}
module.exports={historyItem,historyPage,historyFixture};
