const fail=()=>{throw Object.assign(new Error('JOB_HH_DOM_CHANGED'),{code:'JOB_HH_DOM_CHANGED'});};
const id=x=>/^[1-9]\d{0,19}$/.test(String(x))&&(typeof x!=='number'||Number.isSafeInteger(x))?String(x):null;
const text=(x,max)=>typeof x==='string'&&x.trim()&&x.length<=max?x.trim():null;
function sourceDate(row){
 if(typeof row.creationTime==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:?\d\d)$/.test(row.creationTime)&&Number.isFinite(Date.parse(row.creationTime)))return new Date(row.creationTime).toISOString();
 if(Number.isSafeInteger(row.creationTimeMillis)&&row.creationTimeMillis>=946684800000&&row.creationTimeMillis<4102444800000)return new Date(row.creationTimeMillis).toISOString();return null;
}
function employerStatus(row){
 if(row.lastState==='DISCARD')return row.declinedByApplicant===false?'rejected':'unknown';
 if(row.lastState==='INVITATION')return'invited';
 if(row.lastState==='RESPONSE'&&typeof row.viewedByOpponent==='boolean')return row.viewedByOpponent?'viewed':'not_viewed';return'unknown';
}
function normalizeHistory(raw,{section,page}){
 if(!['active','archived'].includes(section)||!Number.isInteger(page)||page<0||page>=1000||raw?.section!==section||!Number.isSafeInteger(raw.total)||raw.total<0||raw.total>100000||!/^\d{1,4}$/.test(String(raw.pages))||!Array.isArray(raw.topics)||raw.topics.length>100||!Array.isArray(raw.vacancies)||raw.vacancies.length>100)fail();
 const pages=Math.max(1,Number(raw.pages));if(pages>1000||page>=pages||(raw.total>0&&!raw.topics.length)||raw.topics.length>raw.total)fail();const seen=new Set();
 const items=raw.topics.map(row=>{const topicId=id(row?.id),vacancyId=id(row?.vacancyId),resumeId=id(row?.resumeId);if(!topicId||!vacancyId||!resumeId||seen.has(topicId))fail();seen.add(topicId);
 const vs=raw.vacancies.filter(v=>id(v?.vacancyId)===vacancyId);if(vs.length>1)fail();const v=vs[0];
 return{topicId,vacancyId,resumeId,resumeHash:null,resumeTitle:null,title:text(v?.name,500),company:text(v?.company?.name,300),url:`https://hh.ru/vacancy/${vacancyId}`,appliedAt:row.initialState==='RESPONSE'?sourceDate(row):null,topicCreatedAt:sourceDate(row),status:employerStatus(row),archived:typeof v?.closedForApplicants==='boolean'?v.closedForApplicants:null};});return{section,page,pages,total:raw.total,items};
}
async function readHistoryPage(page,args){
 const u=new URL(page.url());if(u.origin!=='https://hh.ru'||u.pathname!=='/applicant/negotiations'||u.username||u.password||u.searchParams.getAll('filter').length!==1||u.searchParams.get('filter')!==args.section||u.searchParams.getAll('page').length!==1||u.searchParams.get('page')!==String(args.page))fail();
 const raw=await page.evaluate(()=>{const n=document.getElementById('HH-Lux-InitialState'),t=n?.content?.textContent||n?.textContent||'';if(!t||new TextEncoder().encode(t).length>5000000)return null;let s;try{s=JSON.parse(t);}catch{return null;}const r=s.applicantNegotiations,v=s.vacanciesShort?.vacanciesList;
 if(!r||!Array.isArray(r.topicList)||r.topicList.length>100||(!Array.isArray(v)&&!(r.total===0&&r.topicList.length===0))||Array.isArray(v)&&v.length>100)return null;
 return{section:r.filterInUse,total:r.total,pages:r.pageCount,topics:r.topicList.map(x=>({id:x.id,vacancyId:x.vacancyId,resumeId:x.resumeId,initialState:x.initialState,lastState:x.lastState,viewedByOpponent:x.viewedByOpponent,creationTime:x.creationTime,creationTimeMillis:x.creationTimeMillis,declinedByApplicant:x.declinedByApplicant})),vacancies:(v||[]).map(x=>({vacancyId:x.vacancyId,name:x.name,company:{name:x.company?.name},closedForApplicants:x.closedForApplicants}))};});return normalizeHistory(raw,args);
}
module.exports={normalizeHistory,readHistoryPage,employerStatus};
