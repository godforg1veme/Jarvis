const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeHistory}=require('../src/hhHistoryReader');
const raw=()=>({section:'active',total:1,pages:'1',topics:[{id:1,vacancyId:2,resumeId:3,initialState:'RESPONSE',lastState:'RESPONSE',
 viewedByOpponent:true,creationTime:'2026-10-16T10:00:00+03:00',declinedByApplicant:false}],vacancies:[{vacancyId:2,name:'Fixture',company:{name:'Fixture'}}]});
test('history exports only bounded metadata and explicit statuses',()=>{
 let r=raw();r.topics[0].privateText='Do not export';let result=normalizeHistory(r,{section:'active',page:0});
 assert.equal(result.items[0].status,'viewed');assert.equal(result.items[0].appliedAt,'2026-10-16T07:00:00.000Z');assert.equal(JSON.stringify(result).includes('Do not export'),false);
 for(const [lastState,status]of[['DISCARD','rejected'],['INVITATION','invited'],['OTHER','unknown']]){r=raw();r.topics[0].lastState=lastState;assert.equal(normalizeHistory(r,{section:'active',page:0}).items[0].status,status);}
 r=raw();r.topics[0].lastState='DISCARD';r.topics[0].declinedByApplicant=true;assert.equal(normalizeHistory(r,{section:'active',page:0}).items[0].status,'unknown');
});
test('history rejects wrong scope/filter/page, duplicate identity and limits',()=>{
 for(const change of[{section:'archived'},{pages:'1001'},{total:100001},{topics:[{vacancyId:2,resumeId:3}]},{topics:[...raw().topics,...raw().topics]}])assert.throws(()=>normalizeHistory({...raw(),...change},{section:'active',page:0}));
 assert.throws(()=>normalizeHistory(raw(),{section:'active',page:1}));assert.throws(()=>normalizeHistory(raw(),{section:'foreign',page:0}));
});
test('unknown dates/details stay unknown; explicit empty archive is valid',()=>{
 const r=raw();r.topics[0].creationTime='16 октября';r.topics[0].viewedByOpponent=false;r.vacancies=[];
 const i=normalizeHistory(r,{section:'active',page:0}).items[0];assert.equal(i.appliedAt,null);assert.equal(i.title,null);assert.equal(i.status,'not_viewed');
 assert.deepEqual(normalizeHistory({section:'archived',total:0,pages:'0',topics:[],vacancies:[]},{section:'archived',page:0}).items,[]);
});
