const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('../job-browser/node_modules/playwright');
const root=path.resolve(__dirname,'../mini-app/dist');
const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!file){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/jobResumes.css"><style>body{margin:16px auto;max-width:680px;padding:0 12px}.job-panel{margin:0}</style><section class="job-panel" id="panel"><h2>Личный профиль HH</h2></section></html>');return;}
  if(!['jobResumes.js','api.js','style.css','jobResumes.css'].includes(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':'text/css'}).end(await fs.readFile(path.join(root,file)));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const engine=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    for(const width of [1280,390]) {
      const context=await engine.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const data={connected:true,primaryResumeId:'resumeA',connectionRevision:1,revision:1,resumes:[
        {id:'resumeA',title:'Менеджер по закупкам и снабжению',canRaise:true},{id:'resumeB',title:'Руководитель отдела логистики и международных перевозок',canRaise:false}],
        updatedAt:'2026-10-21T20:30:00.000Z',autoRaise:{enabled:false,resumeId:null,nextAt:null,lastAt:null,lastOutcome:null},lastError:null,raiseAvailable:true};
      const posts=[],operations=new Map();let loseNext=false;
      await page.exposeFunction('fixtureRequest',async(url,method='GET',body)=>{
        if(url==='/jobs/resumes')return structuredClone(data);
        if(url==='/jobs/resumes/refresh'){operations.set(body.requestId,{status:'complete',kind:'refresh'});return{status:'complete',kind:'refresh'};}
        if(url.startsWith('/jobs/resumes/operations/'))return operations.get(url.split('/').at(-1));
        assert.equal(url,'/jobs/resumes/settings');assert.equal(method,'POST');posts.push(body);
        assert.equal(body.expectedRevision,data.revision);assert.equal(body.connectionRevision,data.connectionRevision);
        if(data.primaryResumeId!==body.resumeId)data.connectionRevision++;
        data.primaryResumeId=body.resumeId;data.revision++;data.autoRaise={...data.autoRaise,enabled:body.autoRaiseEnabled,resumeId:body.resumeId,nextAt:body.autoRaiseEnabled?'2026-10-22T00:00:00.000Z':null};
        const result={status:'complete',kind:'settings',requestId:body.requestId};operations.set(body.requestId,result);
        if(loseNext){loseNext=false;return{__uncertain:true};}return result;
      });
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.evaluate(async()=>{
        const {createJobResumePanel}=await import('/jobResumes.js');
        window.manager=createJobResumePanel({actor:{telegramId:'101'},parent:document.querySelector('#panel'),api:{async request(...args){
          const result=await window.fixtureRequest(...args);if(result.__uncertain)throw Object.assign(Error('Результат неизвестен. Проверь исходный запрос.'),{uncertain:true});return result;
        }}});window.manager.show();
      });
      const select=page.getByRole('combobox',{name:'Резюме для откликов'});
      await select.selectOption('resumeB');await page.getByRole('checkbox',{name:'Автоподнятие выбранного резюме'}).check();
      await page.getByRole('button',{name:'Проверить изменения',exact:true}).click();
      assert.equal(posts.length,0);await page.getByText(/Основное резюме: «Руководитель отдела логистики/).waitFor();
      await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('select').value==='resumeB'&&!document.querySelector('select').disabled);
      assert.equal(posts.length,1);assert.equal(data.autoRaise.enabled,true);
      const folder=path.resolve(__dirname,'../.superpowers/job-resumes');await fs.mkdir(folder,{recursive:true});
      await page.screenshot({path:path.join(folder,width+'.png'),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      loseNext=true;await select.selectOption('resumeA');await page.getByRole('checkbox',{name:'Автоподнятие выбранного резюме'}).uncheck();
      await page.getByRole('button',{name:'Проверить изменения',exact:true}).click();await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
      await page.getByRole('button',{name:'Проверить исходный запрос',exact:true}).waitFor();
      assert.equal(posts.length,2);assert.equal(await select.isDisabled(),true);
      await page.getByRole('button',{name:'Проверить исходный запрос',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('select').disabled);
      assert.equal(posts.length,2);assert.equal(data.primaryResumeId,'resumeA');
      const storage=await page.evaluate(()=>JSON.stringify({...sessionStorage}));assert.ok(!storage.includes('resumeA')&&!storage.includes('resumeB')&&!storage.includes('Руководитель'));
      assert.deepEqual(errors,[]);await page.evaluate(()=>window.manager.dispose());await context.close();
    }
    console.log('PASS resume panel 1280/390: permanent choice, opt-in preview, save, original-ID lost-ack check, no replay or horizontal overflow.');
  }finally{await engine.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
