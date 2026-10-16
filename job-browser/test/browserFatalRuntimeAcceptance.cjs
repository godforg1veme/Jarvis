const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID, randomBytes } = require('node:crypto');
const { ManualState, initial } = require('../src/manualState');
const { bounded } = require('../src/browserHealth');

test('actual browser main exits after Chromium loss, restarts with original pause/claims and stops normally', {timeout:30000},async()=>{
  const profile='/home/pwuser/profile';assert.deepEqual(await fs.readdir(profile),[]);
  const ownerId=randomUUID(),token=randomBytes(32).toString('hex');
  const store=new ManualState({root:profile+'/manual-recovery',ownerId});
  await store.write({...initial(ownerId),phase:'pending',revision:1,target:'https://hh.ru/vacancy/123',recoveryId:randomUUID(),claims:['a'.repeat(64)]});
  const expected=await store.read();
  const env={...process.env,JARVIS_JOB_BROWSER_ENABLED:'1',JARVIS_JOB_BROWSER_OWNER_ID:ownerId,JARVIS_JOB_BROWSER_TOKEN:token,
    JARVIS_HH_CAPTCHA_TELEGRAM:'1',JARVIS_JOB_CAPTCHA_TOKEN:randomBytes(32).toString('hex')};
  const launch=async()=>{
    const child=spawn(process.execPath,['src/browserMain.js'],{env,stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',data=>{stderr+=data;});
    await bounded(()=>new Promise((resolve,reject)=>{
      child.stdout.on('data',data=>{if(data.toString().includes('JOB_BROWSER_READY'))resolve();});
      child.once('exit',()=>reject(Error('FIXTURE_START_FAILED')));child.once('error',reject);
    }),10000).catch(error=>{child.kill('SIGKILL');throw error;});
    return {child,stderr:()=>stderr};
  };
  let first,second;
  try {
    first=await launch();
    const children=(await fs.readFile(`/proc/${first.child.pid}/task/${first.child.pid}/children`,'utf8')).trim().split(/\s+/);
    let browserPid;
    for(const id of children){
      if(!/^\d+$/.test(id))continue;
      const cmd=await fs.readFile(`/proc/${id}/cmdline`,'utf8').catch(()=>'');
      if(cmd.includes('chrome-headless-shell')&&!cmd.includes('--type='))browserPid=Number(id);
    }
    assert.ok(browserPid,'fixture Chromium child found');
    const exited=once(first.child,'exit');process.kill(browserPid,'SIGKILL');
    assert.deepEqual(await bounded(()=>exited,10000),[1,null]);
    assert.match(first.stderr(),/^JOB_BROWSER_UNHEALTHY\n$/);
    assert.deepEqual(await store.read(),expected);
    second=await launch();
    const health=await fetch('http://127.0.0.1:8080/health',{headers:{authorization:`Bearer ${token}`}});
    assert.equal(health.status,200);assert.deepEqual(await store.read(),expected);
    const stopped=once(second.child,'exit');second.child.kill('SIGTERM');
    assert.deepEqual(await bounded(()=>stopped,10000),[0,null]);assert.equal(second.stderr(),'');
  }finally{for(const run of [first,second])if(run&&run.child.exitCode===null)run.child.kill('SIGKILL');}
});
