const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {historyFixture}=require('./helpers/jobHistoryFixture');

test('automatic-model migration removes every saved override and old input without changing filters or collection progress',async()=>{
 const f=await historyFixture();try{
  await f.cb('job:menu');
  const search=f.runtime.telegramService.searchRepository;
  const original=await search.getSettings({userId:f.owner});
  const value={...original.settings,queries:['Fixture query'],officeCity:'Москва',model:'obsolete/custom'};
  await f.pool.query("UPDATE job_searches SET settings=$1,checkpoint='2026-10-20T12:00:00Z',progress=$2 WHERE user_id=$3",[value,{windows:[{query:'Fixture query',page:3}]},f.owner]);
  const before=(await f.pool.query('SELECT * FROM job_searches WHERE user_id=$1',[f.owner])).rows[0];
  const confirmation=(await f.pool.query("INSERT INTO job_confirmations(user_id,conversation_id,chat_id,channel,kind,target_id,frozen,expires_at) VALUES($1,$2,$3,'telegram','settings',$4,$5,now()+interval '10 minutes') RETURNING id",[f.owner,f.scope.conversationId,f.scope.chatId,before.id,{revision:before.revision,value}])).rows[0];
  await f.pool.query("INSERT INTO telegram_interactions(id,user_id,conversation_id,chat_id,kind,context,expires_at) VALUES(gen_random_uuid(),$1,$2,$3,'job_setting_value',$4,now()+interval '10 minutes')",[f.owner,f.scope.conversationId,f.scope.chatId,{targetId:before.id,revision:before.revision,field:'model',returnPage:0}]);
  const sql=await fs.readFile(path.join(__dirname,'../src/db/migrations/045_job_automatic_model.sql'),'utf8');
  await f.pool.query(sql);
  const after=(await f.pool.query('SELECT * FROM job_searches WHERE user_id=$1',[f.owner])).rows[0];
  const {model,...expected}=value;assert.deepEqual(after.settings,expected);
  for(const key of ['revision','checkpoint','progress','status','lease_id','lease_until'])assert.deepEqual(after[key],before[key],key);
  assert.equal((await f.pool.query('SELECT status FROM job_confirmations WHERE id=$1',[confirmation.id])).rows[0].status,'stale');
  assert.equal((await f.pool.query("SELECT status FROM telegram_interactions WHERE user_id=$1 AND context->>'field'='model'",[f.owner])).rows[0].status,'cancelled');
  const panel=await f.cb('job:settings');assert.ok(!panel.buttons.flat().some(b=>b.data?.includes(':model:')));
  for(const action of ['cfg','cfg_input','cfg_pick'])await f.cb(`job:${action}:model:${before.revision}:0`);
  assert.equal((await f.runtime.telegramService.interactions.getActive(f.scope)).interaction,null);
  assert.deepEqual((await search.getSettings({userId:f.owner})).settings,expected);
  assert.equal(f.modelCalls,0);assert.equal(f.submits,0);
 }finally{await f.close();}
});
