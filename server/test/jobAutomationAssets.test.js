const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const Fastify=require('fastify');
const {registerMiniAppAssets}=require('../src/miniAppAssets');
test('production Mini App route serves the automation import without opening arbitrary files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'job-automation-assets-'));
  const app=Fastify();
  try{
    const module=await fs.readFile(path.join(__dirname,'../../mini-app/src/jobAutomation.js'),'utf8');
    await fs.writeFile(path.join(root,'jobAutomation.js'),module);
    registerMiniAppAssets(app,{root});
    const response=await app.inject({method:'GET',url:'/mini/jobAutomation.js'});
    assert.equal(response.statusCode,200);assert.equal(response.body,module);
    assert.match(response.headers['content-type'],/javascript/);
    assert.equal((await app.inject({method:'GET',url:'/mini/preview.js'})).statusCode,404);
    assert.equal((await app.inject({method:'GET',url:'/mini/.env'})).statusCode,404);
  }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});
