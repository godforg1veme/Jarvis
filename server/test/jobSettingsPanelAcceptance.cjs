const test=require('node:test'),assert=require('node:assert/strict');
const {historyFixture}=require('./helpers/jobHistoryFixture');
const {fields}=require('../src/jobs/jobSettingsControls');
const {KINDS,validateContext}=require('../src/telegram/telegramInteractionRepository');

async function fixture() {
  const f=await historyFixture(); let update=50000;
  f.runtime.telegramService.settingsModels=['fixture/default','fixture/fallback'];
  const search=()=>f.runtime.telegramService.searchRepository.getSettings({userId:f.owner});
  const msg=(text,from=101,chat=from,type='private')=>f.messages.handle({update_id:++update,message:{message_id:update,from:{id:from},chat:{id:chat,type},text}});
  const active=async()=>(await f.runtime.telegramService.interactions.getActive(f.scope)).interaction;
  await f.cb('job:menu');
  return {...f,search,msg,active,get reads(){return f.reads;},get modelCalls(){return f.modelCalls;},get submits(){return f.submits;}};
}
const saveButton=v=>v.buttons.flat().find(b=>b.data?.startsWith('job:cfg_ok:')).data;

test('real panel emits clickable settings and bounded pages without starting input or external work',async()=>{
  const f=await fixture();try{
    const panel=await f.cb('job:settings');assert.match(panel.answer,/Настройки поиска/);assert.equal(await f.active(),null);
    assert.equal(panel.buttons.length,10);assert.ok(!panel.answer.includes('AI Engineer'));
    for(const [field,def] of Object.entries(fields)) {
      const button=panel.buttons.flat().find(b=>b.data?.startsWith(`job:cfg:${field}:`));assert.ok(button,def.label);
      const view=await f.cb(button.data);assert.ok(view.buttons.length);
      if(['queries','exclusions'].includes(field))assert.match(view.answer,/Страница/);
      else assert.match(view.answer,/Сейчас:/);
    }
    const s=await f.search();assert.deepEqual(s.settings.queries,[]);assert.equal(s.settings.targetRub,null);assert.equal(s.settings.officeCity,'');assert.equal(s.settings.remote,null);
    s.settings.queries=Array.from({length:9},(_,i)=>`Fixture query ${i}`);await f.pool.query('UPDATE job_searches SET settings=$1 WHERE user_id=$2',[s.settings,f.owner]);
    const next=await f.cb(`job:cfg:queries:${s.revision}:1`);assert.match(next.answer,/Страница 2/);
    assert.equal(f.reads,0);assert.equal(f.modelCalls,0);assert.equal(f.submits,0);
    const constraint=(await f.pool.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='telegram_interactions_kind_check' AND conrelid='telegram_interactions'::regclass")).rows[0].d;
    assert.ok(KINDS.has('job_setting_value'));assert.match(constraint,/job_setting_value/);
  }finally{await f.close();}
});

test('real presets and all custom scalar values save only after one scoped confirmation',async()=>{
  const f=await fixture();try{
    for(const [field,index,expected] of [['salary',2,150000],['interval',2,3600000],['history',3,30],['budget',2,5],['remote',1,false]]) {
      const before=await f.search(),preview=await f.cb(`job:cfg_pick:${field}:${before.revision}:${index}`);
      assert.deepEqual((await f.search()).settings,before.settings);
      const approved=await f.cb(saveButton(preview));assert.match(approved.answer,/Изменения сохранены/);
      assert.equal((await f.search()).settings[fields[field].key],expected);
      assert.match((await f.cb(saveButton(preview))).answer,/недоступно/);
      const current=await f.search();assert.match((await f.cb(`job:cfg_pick:${field}:${current.revision}:${index}`)).answer,/уже установлено/);
    }
    for(const [field,text,expected] of [['salary','120 500',120500],['city','Казань','Казань'],['interval','45',2700000],['history','10',10],['budget','2,5',2.5],['model','fixture/custom','fixture/custom']]) {
      const before=await f.search();await f.cb(`job:cfg_input:${field}:${before.revision}:0`);
      const pending=await f.active();assert.equal(pending.kind,'job_setting_value');
      if(field==='interval') {await f.msg('0');assert.equal((await f.active()).id,pending.id);}
      const preview=await f.msg(text);assert.equal(await f.active(),null);assert.deepEqual((await f.search()).settings,before.settings);
      await f.cb(saveButton(preview));assert.equal((await f.search()).settings[fields[field].key],expected);
    }
    const s=await f.search();const view=await f.cb(`job:cfg:model:${s.revision}:0`);assert.match(view.answer,/fixture\/custom/);
    const configured=view.buttons.flat().find(b=>b.text==='fixture/default');assert.ok(configured);assert.ok(!configured.data.includes('fixture'));
    await f.cb(saveButton(await f.cb(configured.data)));assert.equal((await f.search()).settings.model,'fixture/default');
    const selected=await f.search();const inherited=await f.cb(`job:cfg_pick:model:${selected.revision}:0`);await f.cb(saveButton(inherited));assert.equal((await f.search()).settings.model,'');
    assert.equal(f.modelCalls,0);assert.equal(f.reads,0);assert.equal(f.submits,0);
  }finally{await f.close();}
});

test('real query/exclusion lists add, deduplicate, show full text and confirm exact removal',async()=>{
  const f=await fixture();try{
    for(const field of ['queries','exclusions']) {
      const before=await f.search();await f.cb(`job:cfg_input:${field}:${before.revision}:0`);
      const preview=await f.msg('Private fixture phrase');assert.equal((await f.search()).settings[field].includes('Private fixture phrase'),false);
      const saved=await f.cb(saveButton(preview));assert.match(saved.answer,/Страница/);assert.ok(saved.buttons.flat().some(b=>b.text.includes('Private fixture phrase')));
      let s=await f.search();await f.cb(`job:cfg_input:${field}:${s.revision}:0`);assert.match((await f.msg('Private fixture phrase')).answer,/уже установлено/);assert.equal((await f.search()).revision,s.revision);
      const index=s.settings[field].indexOf('Private fixture phrase');assert.match((await f.cb(`job:cfg_item:${field}:${s.revision}:${index}`)).answer,/Private fixture phrase/);
      const remove=await f.cb(`job:cfg_remove:${field}:${s.revision}:${index}`);assert.equal((await f.search()).settings[field].includes('Private fixture phrase'),true);
      await f.cb(saveButton(remove));assert.equal((await f.search()).settings[field].includes('Private fixture phrase'),false);
      assert.match((await f.cb(`job:cfg_remove:${field}:${s.revision}:${index}`)).answer,/Данные изменились/);
    }
    const state=await f.search();state.settings.queries=['Only fixture query'];await f.pool.query('UPDATE job_searches SET settings=$1,revision=revision+1 WHERE user_id=$2',[state.settings,f.owner]);
    const current=await f.search();await f.cb(saveButton(await f.cb(`job:cfg_remove:queries:${current.revision}:0`)));assert.deepEqual((await f.search()).settings.queries,[]);
    current.settings.exclusions=Array.from({length:50},(_,i)=>`Fixture exclusion ${i}`);
    await f.pool.query('UPDATE job_searches SET settings=$1,revision=revision+1 WHERE user_id=$2',[current.settings,f.owner]);
    const full=await f.search(),fullView=await f.cb(`job:cfg:exclusions:${full.revision}:0`);assert.ok(!fullView.buttons.flat().some(b=>b.text.includes('Добавить')));
    await f.cb(`job:cfg_input:exclusions:${full.revision}:0`);assert.match((await f.msg('One more fixture phrase')).answer,/Список заполнен/);assert.equal((await f.search()).settings.exclusions.length,50);
    const history=(await f.pool.query('SELECT content FROM messages')).rows.map(x=>x.content).join('\n');assert.ok(!history.includes('Private fixture phrase'));
  }finally{await f.close();}
});

test('multiline lists validate before consumption, confirm as one change and clear with a single confirmation',async()=>{
  const f=await fixture();try{
    let s=await f.search();assert.match((await f.cb('job:resume')).answer,/Сначала добавь поисковые запросы/);
    await f.cb(`job:cfg_input:queries:${s.revision}:0`);const pending=await f.active();
    await f.msg('Закупки\nX');assert.equal((await f.active()).id,pending.id);assert.deepEqual((await f.search()).settings.queries,[]);
    await f.pool.query("UPDATE job_searches SET checkpoint=now()-interval '1 hour' WHERE user_id=$1",[f.owner]);
    const preview=await f.msg('Закупки\r\nСнабжение\n\nЗакупки');assert.equal(await f.active(),null);assert.match(preview.answer,/1\. Закупки\n2\. Снабжение/);assert.deepEqual((await f.search()).settings.queries,[]);
    await f.cb(saveButton(preview));assert.deepEqual((await f.search()).settings.queries,['Закупки','Снабжение']);
    assert.equal((await f.search()).checkpoint,null);
    assert.match((await f.cb(saveButton(preview))).answer,/недоступно/);
    await f.cb('job:resume');assert.equal((await f.search()).settings.activated,true);
    s=await f.search();const clear=await f.cb(`job:cfg_pick:queries:${s.revision}:0`);assert.match(clear.answer,/Поиск будет выключен/);assert.equal((await f.search()).settings.queries.length,2);
    await f.cb(saveButton(clear));s=await f.search();assert.deepEqual(s.settings.queries,[]);assert.equal(s.settings.activated,false);assert.equal(s.settings.paused,true);
    for(const [field,index,key] of [['salary',4,'targetRub'],['city',0,'officeCity'],['remote',2,'remote']]) {
      s=await f.search();const value=await f.cb(`job:cfg_pick:${field}:${s.revision}:${index}`);assert.match(value.answer,/уже установлено/);
    }
    assert.equal(f.reads,0);assert.equal(f.modelCalls,0);assert.equal(f.submits,0);
  }finally{await f.close();}
});

test('real input cancels on navigation and rejects foreign scopes, stale revisions and expired confirmations',async()=>{
  const f=await fixture();try{
    let s=await f.search();const input=`job:cfg_input:city:${s.revision}:0`;
    for(const args of [[202],[101,-100,'group'],[101,999]])assert.match((await f.cb(input,...args)).answer,/владельцу|личном/);
    await f.cb(input);const active=await f.active();assert.throws(()=>validateContext('job_setting_value',{...active.context,extra:'unsafe'}));
    await f.msg('Foreign city',202);assert.equal((await f.active()).id,active.id);
    await f.cb('job:settings');assert.equal(await f.active(),null);await f.msg('ordinary fixture conversation');assert.equal((await f.search()).settings.officeCity,s.settings.officeCity);
    await f.cb(input);await f.pool.query("UPDATE telegram_interactions SET expires_at=now()-interval '1 minute' WHERE id=$1",[(await f.active()).id]);
    assert.match((await f.msg('Expired city')).answer,/Время ввода закончилось/);
    await f.cb(input);await f.pool.query('UPDATE job_searches SET revision=revision+1 WHERE user_id=$1',[f.owner]);assert.match((await f.msg('Stale city')).answer,/Данные изменились/);
    s=await f.search();const preview=await f.cb(`job:cfg_pick:interval:${s.revision}:2`),data=saveButton(preview);
    assert.match((await f.cb(data,202)).answer,/разрешении/);assert.match((await f.cb(data,101,-100,'group')).answer,/личном/);
    assert.match((await f.cb(data,101,999)).answer,/личном/);
    const other=(await f.pool.query("SELECT id FROM conversations WHERE user_id=$1 AND channel='telegram' AND external_chat_id='202'",[f.stranger])).rows[0];
    await assert.rejects(f.runtime.telegramService.settingsService.approve({scope:{...f.scope,conversationId:other.id},confirmationId:data.split(':')[2],panel:true}),{code:'JOB_SCOPE_DENIED'});
    await f.pool.query("UPDATE job_confirmations SET expires_at=now()-interval '1 minute' WHERE id=$1",[data.split(':')[2]]);
    assert.match((await f.cb(data)).answer,/недоступно/);assert.equal((await f.search()).revision,s.revision);
    const again=await f.cb(`job:cfg_pick:interval:${s.revision}:2`);await f.pool.query('UPDATE job_searches SET revision=revision+1 WHERE user_id=$1',[f.owner]);assert.match((await f.cb(saveButton(again))).answer,/Данные изменились/);
    s=await f.search();const fresh=await f.cb(`job:cfg_pick:interval:${s.revision}:2`),update=f.callbackUpdate(saveButton(fresh));await f.messages.handleCallback(update);assert.equal((await f.messages.handleCallback(update)).status,'duplicate');
    s=await f.search();await f.cb(`job:cfg_input:city:${s.revision}:0`);
    const inputUpdate={update_id:90000,message:{message_id:90000,from:{id:101},chat:{id:101,type:'private'},text:'Самара'}};
    const once=await f.messages.handle(inputUpdate);assert.equal((await f.messages.handle(inputUpdate)).status,'duplicate');
    assert.equal((await f.search()).settings.officeCity,s.settings.officeCity);await f.cb(saveButton(once));assert.equal((await f.search()).settings.officeCity,'Самара');
    s=await f.search();await f.cb(`job:cfg_input:city:${s.revision}:0`);const cancelled=await f.msg('Омск');await f.cb('job:settings');
    assert.match((await f.cb(saveButton(cancelled))).answer,/недоступно/);assert.equal((await f.search()).settings.officeCity,'Самара');
    assert.equal(f.modelCalls,0);assert.equal(f.reads,0);assert.equal(f.submits,0);
  }finally{await f.close();}
});
