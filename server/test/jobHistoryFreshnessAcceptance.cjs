const test=require('node:test'),assert=require('node:assert/strict');
const {historyFixture,historyItem,historyPage}=require('./helpers/jobHistoryFixture');

test('legacy invitations are unconfirmed; current active and archived invitations keep separate evidence and source ordering',async()=>{
 const f=await historyFixture();try{
  const invitation=historyItem('11',{status:'invited',appliedAt:null,topicCreatedAt:'2020-01-01T00:00:00.000Z'});
  await f.runtime.historyRepository.observe({scope:f.scope,item:invitation});
  let view=await f.cb('job:applications:0');
  assert.match(view.answer,/Приглашение не подтверждено/);
  f.pages.set('active:0',historyPage('active',[historyItem('12',{vacancyId:'124',url:'https://hh.ru/vacancy/124',appliedAt:'2026-10-15T00:00:00.000Z',topicCreatedAt:'2026-10-15T00:00:00.000Z'})]));
  f.pages.set('archived:0',historyPage('archived',[invitation]));
  await f.tick();await f.tick();
  const list=await f.runtime.historyRepository.list({scope:f.scope});
  assert.equal(list.items[0].external_vacancy_id,'124');
  const archived=list.items.find(x=>x.external_vacancy_id==='123');
  assert.equal(archived.history_section,'archived');assert.equal(archived.current_observation,true);
  view=await f.cb('job:applications:0');assert.match(view.answer,/Приглашение \(архив\)/);
  const detail=await f.cb(`job:application:${archived.id}`);
  assert.match(detail.answer,/Дата записи HH:/);assert.match(detail.answer,/2020/);assert.match(detail.answer,/Проверено:/);
  f.pages.set('active:0',historyPage('active',[invitation]));f.pages.set('archived:0',historyPage('archived',[]));
  await f.cb('job:applications_sync');await f.tick();await f.tick();
  view=await f.cb('job:applications:0');assert.match(view.answer,/HH: Приглашение · Проверено:/);
  f.pages.set('active:0',historyPage('active',[{...invitation,status:'unknown'}]));
  await f.cb('job:applications_sync');await f.tick();await f.tick();
  view=await f.cb('job:applications:0');assert.match(view.answer,/Приглашение не подтверждено/);
  f.pages.set('active:0',historyPage('active',[]));
  await f.cb('job:applications_sync');await f.tick();await f.tick();
  const missing=(await f.runtime.historyRepository.list({scope:f.scope})).items.find(x=>x.id===archived.id);
  assert.equal(missing.current_observation,false);
  view=await f.cb(`job:application:${archived.id}`);assert.match(view.answer,/Приглашение не подтверждено/);
  assert.match(view.answer,/не найдена при последней полной проверке/);
  assert.equal(f.submits,0);assert.equal(f.modelCalls,0);
 }finally{await f.close();}
});
