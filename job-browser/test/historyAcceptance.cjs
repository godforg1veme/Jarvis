const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {HhBrowser}=require('../src/hhBrowser');
const {readExistingApplication,visibleAppliedAction}=require('../src/existingApplication');
const {readHistoryPage}=require('../src/hhHistoryReader');
const {CaptchaTelegramBrowser}=require('../src/captchaTelegramBrowser');
const {randomUUID}=require('node:crypto');

test('Chromium history uses explicit active/archive pages, exact account and no chat or mutation requests',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 const context=await browser.newContext();let posts=0,chats=0,foreignResume=false;
 try{
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(req.method()!=='GET'){posts++;return route.abort();}if(/chatik|\/chat\//.test(url.href)){chats++;return route.abort();}
  if(url.origin!=='https://hh.ru')return route.abort();
  if(url.pathname==='/applicant/resumes')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>Мои резюме</h1><div data-qa="resume"><span data-qa="resume-title">Fixture</span><a href="/resume/${foreignResume?'otherResume':'fixtureResume'}">Резюме</a></div>`});
  if(url.pathname==='/applicant/negotiations'){
   const archived=url.searchParams.get('filter')==='archived',page=Number(url.searchParams.get('page'));
   const state={applicantNegotiations:{filterInUse:archived?'archived':'active',total:archived?1:2,pageCount:archived?'1':'2',topicList:[{id:archived?30:10+page,vacancyId:100+page,resumeId:archived?900:800,lastState:archived?'DISCARD':'RESPONSE',initialState:'RESPONSE',declinedByApplicant:false,viewedByOpponent:page===1,creationTime:'2026-10-01T12:00:00+03:00',privateMessage:'must not leave browser'}]},vacanciesShort:{vacanciesList:[]}};
   return route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>Отклики</h1><template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>`});
  }return route.abort();
 });
 const hh=new HhBrowser({context,primaryResumeId:'fixtureResume'});
 const a=await hh.history({section:'active',page:0}),b=await hh.history({section:'active',page:1}),c=await hh.history({section:'archived',page:0});
 assert.equal(a.pages,2);assert.equal(a.items[0].status,'not_viewed');assert.equal(b.items[0].status,'viewed');assert.equal(c.items[0].status,'rejected');assert.equal(c.items[0].resumeId,'900');
 assert.equal(JSON.stringify([a,b,c]).includes('privateMessage'),false);
 foreignResume=true;await assert.rejects(hh.history({section:'active',page:0}),{code:'JOB_HH_RESUME_UNAVAILABLE'});
 assert.equal(posts,0);assert.equal(chats,0);
 }finally{await context.close();await browser.close();}
});

test('Chromium existing-response proof binds selected resume/topic even without a letter; hidden buttons are not proof',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});const page=await browser.newPage();
 try{await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<button style="display:none" data-qa="vacancy-response-link-view-topic">Hidden</button>'}));
 await page.goto('https://hh.ru/vacancy/123');assert.equal(await visibleAppliedAction(page),false);
 const args={externalId:'123',resumeId:'fixtureResume',vacancy:{title:'Fixture',company:'Fixture',archived:false}};
 assert.equal(await readExistingApplication(page,args),null);
 await page.evaluate(()=>{const n=document.createElement('template');n.id='HH-Lux-InitialState';n.innerHTML=JSON.stringify({applicantVacancyResponseStatuses:{'123':{resumes:{'8':{id:8,hash:'fixtureResume'}},usedResumeIds:[8],negotiations:{topicList:[{id:9,vacancyId:123,resumeId:8,initialState:'RESPONSE',lastState:'RESPONSE',viewedByOpponent:true,hasResponseLetter:false}]}}}});document.body.append(n);});
 const found=await readExistingApplication(page,args);assert.equal(found.topicId,'9');assert.equal(found.resumeHash,'fixtureResume');assert.equal(found.resumeId,'8');
 assert.equal(await readExistingApplication(page,{...args,resumeId:'foreignResume'}),null);
 }finally{await page.close();await browser.close();}
});

test('Chromium reader refuses redirected/filter-mismatched, ambiguous and oversized states',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});const p=await browser.newPage();
 try{await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<template id="HH-Lux-InitialState"></template>'}));
 await p.goto('https://hh.ru/applicant/negotiations?filter=active&page=0');
 await p.evaluate(()=>{document.querySelector('template').innerHTML='x'.repeat(5000001);});
 await assert.rejects(readHistoryPage(p,{section:'active',page:0}),{code:'JOB_HH_DOM_CHANGED'});
 await assert.rejects(readHistoryPage(p,{section:'archived',page:0}),{code:'JOB_HH_DOM_CHANGED'});
 }finally{await p.close();await browser.close();}
});

test('Chromium CAPTCHA handover and verification cover exact resume/history GET targets without widening mutations',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined}),context=await browser.newContext();
 let captcha=true,wrongFilter=false,handedTarget=null,posts=0,state={operationId:randomUUID(),phase:'blocked'};
 try{
 await context.route('**/*',r=>{if(r.request().method()!=='GET'){posts++;return r.abort();}const u=new URL(r.request().url());
  let body;
  if(u.pathname==='/applicant/resumes')body=captcha?'Подтвердите, что вы не робот':'<h1>Мои резюме</h1><div data-qa="resume"><span data-qa="resume-title">Fixture</span><a href="/resume/fixtureResume">Резюме</a></div>';
  else body=`<h1>Отклики</h1><template id="HH-Lux-InitialState">${JSON.stringify({applicantNegotiations:{filterInUse:wrongFilter?'archived':'active',total:0,pageCount:'0',topicList:[]}})}</template>`;
  return r.fulfill({contentType:'text/html; charset=utf-8',body});
 });
 const hh=new HhBrowser({context,primaryResumeId:'fixtureResume',onManualRequired:async target=>{handedTarget=target;return state.operationId;}});
 await assert.rejects(hh.history({section:'active',page:0}),{code:'JOB_HH_CAPTCHA_MANUAL_REQUIRED'});assert.equal(handedTarget,'https://hh.ru/applicant/resumes');
 captcha=false;
 const controller=new CaptchaTelegramBrowser({context,coordinator:{},journal:{async read(){return state;},async write(v){state=v;}}});
 assert.equal(await controller.verify(handedTarget,state.operationId),true);
 const target='https://hh.ru/applicant/negotiations?filter=active&page=0';assert.equal(await controller.verify(target,state.operationId),true);
 wrongFilter=true;await assert.rejects(controller.verify(target,state.operationId),{code:'JOB_HH_DOM_CHANGED'});
 assert.equal(await controller.verify(target+'&extra=1',state.operationId),false);assert.equal(posts,0);
 }finally{await context.close();await browser.close();}
});
