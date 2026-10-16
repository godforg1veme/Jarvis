const {normalizeHistory}=require('./hhHistoryReader');
async function visibleAppliedAction(page){
  for(const node of (await page.locator('[data-qa="vacancy-response-link-view-topic"], [data-qa="vacancy-response-link-top-again"]').all()).slice(0,20))if(await node.isVisible())return true;
  return false;
}
async function readExistingApplication(page,{externalId,resumeId,vacancy}){
  const u=new URL(page.url());if(u.origin!=='https://hh.ru'||u.pathname!==`/vacancy/${externalId}`)return null;
  const raw=await page.evaluate(({externalId,resumeId})=>{
    const n=document.getElementById('HH-Lux-InitialState'),t=n?.content?.textContent||n?.textContent||'';
    if(!t||new TextEncoder().encode(t).length>5000000)return null;let s;try{s=JSON.parse(t);}catch{return null;}
    const r=s.applicantVacancyResponseStatuses?.[externalId];
    if(!r||!r.resumes||Array.isArray(r.resumes)||Object.keys(r.resumes).length>100||!Array.isArray(r.usedResumeIds)||r.usedResumeIds.length>100||!Array.isArray(r.negotiations?.topicList)||r.negotiations.topicList.length>100)return null;
    const selected=Object.values(r.resumes).filter(x=>x?.hash===resumeId);
    if(selected.length!==1||!r.usedResumeIds.some(x=>String(x)===String(selected[0].id)))return null;
    const topics=r.negotiations.topicList.filter(x=>String(x.resumeId)===String(selected[0].id)&&String(x.vacancyId)===externalId);
    if(topics.length!==1)return null;const x=topics[0];
    return{id:x.id,vacancyId:x.vacancyId,resumeId:x.resumeId,initialState:x.initialState,lastState:x.lastState,viewedByOpponent:x.viewedByOpponent,
      creationTime:x.creationTime,creationTimeMillis:x.creationTimeMillis,declinedByApplicant:x.declinedByApplicant};
  },{externalId,resumeId});
  if(!raw)return null;
  try{return{...normalizeHistory({section:'active',pages:'1',total:1,topics:[raw],vacancies:[{vacancyId:externalId,name:vacancy.title,
    company:{name:vacancy.company},closedForApplicants:vacancy.archived}]},{section:'active',page:0}).items[0],resumeHash:resumeId};}catch{return null;}
}
module.exports={readExistingApplication,visibleAppliedAction};
