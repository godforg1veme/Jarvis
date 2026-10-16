class JobHistoryWorker{
  constructor({repository,client,intervalMs=1500,report=code=>process.stderr.write(`${code}\n`)}){Object.assign(this,{repository,client,intervalMs,report});this.running=false;this.timer=null;}
  async tick(){
    if(this.running)return;this.running=true;let run;
    try{run=await this.repository.claim();if(!run)return;
      const result=await this.client.forUser(run.user_id).history({section:run.section,page:run.page});
      await this.repository.applyPage({run,leaseId:run.lease_id,result});
    }catch(error){if(run)await this.repository.fail({run,leaseId:run.lease_id,code:error?.code});else this.report('JOB_HISTORY_QUEUE_UNAVAILABLE');}
    finally{this.running=false;}
  }
  start(){if(!this.timer){this.timer=setInterval(()=>{void this.tick().catch(()=>this.report('JOB_HISTORY_QUEUE_UNAVAILABLE'));},this.intervalMs);this.timer.unref?.();}}
  async close(){clearInterval(this.timer);this.timer=null;while(this.running)await new Promise(r=>setTimeout(r,10));}
}
module.exports={JobHistoryWorker};
