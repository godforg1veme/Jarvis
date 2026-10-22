const { randomUUID, createHash } = require('node:crypto');
const { z } = require('zod');
const { assertJobScope, jobError } = require('./jobSchemas');
const { settingsInput, resumeSchema, stamp } = require('./jobResumeRepository');
const { response, button } = require('./jobTelegramViews');
const { formatMoscowDateTime } = require('../../../shared/time');

const catalogSchema = z.object({ purpose:z.literal('menu'), accessStamp:z.string(), revision:z.number().int().positive(),
  connectionRevision:z.number().int().positive(), primaryResumeId:z.string(), autoRaiseEnabled:z.boolean(),
  resumes:z.array(resumeSchema).max(20) }).strict();
const changeSchema = z.object({ purpose:z.literal('change'), accessStamp:z.string(), input:settingsInput,
  title:z.string().min(1).max(500) }).strict();
function requestId(context, purpose) {
  const hex=createHash('sha256').update(`${context.requestId}:${purpose}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
class JobResumeTelegram {
  constructor({service,now=Date.now}) {this.service=service;this.repository=service.repository;this.now=now;}
  transaction(scope,fn) {
    return this.repository.transaction(scope.userId,async(c,access)=>{
      await assertJobScope(c,scope,this.repository.accessService);return fn(c,access);
    });
  }
  async load(c,scope,id,purpose,{consumed=false}={}) {
    const row=(await c.query(`SELECT * FROM job_confirmations WHERE id=$1 AND user_id=$2 AND conversation_id=$3
      AND chat_id=$4 AND channel='telegram' AND kind='resume' FOR UPDATE`,[id,scope.userId,scope.conversationId,scope.chatId])).rows[0];
    if(!row || row.frozen?.purpose!==purpose || (row.status!=='pending'&&!(consumed&&row.status==='consumed'))
      || row.status==='pending'&&new Date(row.expires_at).getTime()<=this.now())throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
    return row;
  }
  async menu(scope,context,refresh=false) {
    let state=await this.service.get(scope.userId);
    if(!state.connected)throw jobError('JOB_HH_NOT_CONNECTED');
    if(refresh||!state.updatedAt&&!state.resumes.length){
      try {await this.service.refresh(scope.userId,requestId(context,'resume-refresh'));}
      catch { /* Preserve the cached list and its safe failure status. */ }
      state=await this.service.get(scope.userId);
    }
    const menu=await this.transaction(scope,async(c,a)=>{
      const {connection,manager}=await this.repository.current(c,scope.userId);
      if(connection?.status!=='connected'||connection.revision!==state.connectionRevision||manager.revision!==state.revision)throw jobError('JOB_REVISION_CONFLICT');
      const frozen=catalogSchema.parse({purpose:'menu',accessStamp:stamp(a),revision:state.revision,
        connectionRevision:state.connectionRevision,primaryResumeId:state.primaryResumeId,
        autoRaiseEnabled:state.autoRaise.enabled,resumes:state.resumes});
      return (await c.query(`INSERT INTO job_confirmations(user_id,conversation_id,chat_id,channel,kind,target_id,frozen,expires_at)
        VALUES($1,$2,$3,'telegram','resume',$1,$4,$5) RETURNING id`,[scope.userId,scope.conversationId,scope.chatId,frozen,new Date(this.now()+600000)])).rows[0];
    });
    const primary=state.resumes.find(r=>r.id===state.primaryResumeId);
    const rows=state.resumes.map((r,index)=>[button(`${r.id===state.primaryResumeId?'✓ ':''}${r.title}`.slice(0,60),'rs_pick',`${menu.id}:${index}`)]);
    if(primary||state.autoRaise.enabled)rows.push([button(state.autoRaise.enabled?'Выключить автоподнятие':'Включить автоподнятие','rs_auto',`${menu.id}:${state.autoRaise.enabled?0:1}`)]);
    rows.push([button('Обновить список из HH','resumes_refresh')],[button('В поиск работы','menu')]);
    const details=state.updatedAt?`\nСписок обновлён: ${formatMoscowDateTime(state.updatedAt)}.`:'';
    return response(`Мои резюме HH\nОсновное: ${primary?.title||'выбранное ранее резюме недоступно'}.\nАвтоподнятие: ${state.autoRaise.enabled?'включено':'выключено'}. Только бесплатно, не чаще раза в 4 часа.${details}`
      +(state.autoRaise.lastOutcome==='unknown'?'\nРезультат последнего поднятия неизвестен; автоматика остановлена.':state.lastError?'\nHH не удалось обновить. Показан последний сохранённый список.':'')
      +(!state.raiseAvailable?'\nАвтоподнятие пока не настроено на сервере.':'')+'\nВыбери основное резюме для откликов:',rows);
  }
  async preview(scope,menuId,index,enabled) {
    const result=await this.transaction(scope,async(c,a)=>{
      const row=await this.load(c,scope,menuId,'menu'),menu=catalogSchema.parse(row.frozen);
      const {connection,manager}=await this.repository.current(c,scope.userId);
      if(stamp(a)!==menu.accessStamp||connection?.status!=='connected'||connection.revision!==menu.connectionRevision||manager.revision!==menu.revision)throw jobError('JOB_REVISION_CONFLICT');
      const resume=enabled===undefined?menu.resumes[index]:menu.resumes.find(r=>r.id===menu.primaryResumeId)
        || (enabled===false?{id:menu.primaryResumeId,title:'ранее выбранное резюме'}:null);
      if(!resume)throw jobError('JOB_HH_RESUME_UNAVAILABLE');
      const autoRaiseEnabled=enabled===undefined?menu.autoRaiseEnabled:enabled;
      if(autoRaiseEnabled&&manager.last_outcome==='unknown')throw jobError('operation_unknown');
      const id=randomUUID();const input=settingsInput.parse({requestId:id,resumeId:resume.id,autoRaiseEnabled,
        expectedRevision:menu.revision,connectionRevision:menu.connectionRevision});
      const frozen=changeSchema.parse({purpose:'change',accessStamp:menu.accessStamp,input,title:resume.title});
      await c.query(`UPDATE job_confirmations SET status='cancelled' WHERE user_id=$1 AND conversation_id=$2 AND chat_id=$3
        AND kind='resume' AND frozen->>'purpose'='change' AND status='pending'`,[scope.userId,scope.conversationId,scope.chatId]);
      await c.query(`INSERT INTO job_confirmations(id,user_id,conversation_id,chat_id,channel,kind,target_id,frozen,expires_at)
        VALUES($1,$2,$3,$4,'telegram','resume',$2,$5,$6)`,[id,scope.userId,scope.conversationId,scope.chatId,frozen,new Date(this.now()+600000)]);
      return {id,resume,autoRaiseEnabled};
    });
    return response(`Проверь изменения HH\nОсновное резюме: «${result.resume.title}».\nАвтоподнятие: ${result.autoRaiseEnabled?'включено — бесплатно, не чаще раза в 4 часа':'выключено'}.\nПрежние подтверждения откликов с другим резюме станут неактуальными.\nСохранить?`,
      [[button('Подтвердить','rs_ok',result.id),button('Отмена','resumes')]]);
  }
  async confirm(scope,id) {
    const frozen=await this.transaction(scope,async(c,a)=>{
      const row=await this.load(c,scope,id,'change',{consumed:true}),value=changeSchema.parse(row.frozen);
      if(stamp(a)!==value.accessStamp)throw jobError('JOB_REVISION_CONFLICT');
      if(row.status==='pending'){
        const {connection,manager}=await this.repository.current(c,scope.userId);
        if(connection?.status!=='connected'||connection.revision!==value.input.connectionRevision||manager.revision!==value.input.expectedRevision)throw jobError('JOB_REVISION_CONFLICT');
        await c.query("UPDATE job_confirmations SET status='consumed' WHERE id=$1",[id]);
      }
      return value;
    });
    // Same confirmation ID is the durable settings request. A consumed button
    // cannot authorize a second selection, even if Telegram lost the first reply.
    const operation=await this.service.settings(scope.userId,frozen.input);
    await this.transaction(scope,async()=>{});
    return this.outcome(operation,id);
  }
  outcome(op,id) {
    return response(op.status==='complete'?'Основное резюме и автоподнятие сохранены.':op.status==='failed'?'Изменения не сохранены. Открой актуальный список.':'Результат пока не подтверждён. Новая смена не отправлена; проверь исходный запрос.',
      [...(!['complete','failed'].includes(op.status)?[[button('Проверить исходный запрос','rs_status',id)]]:[]),[button('Мои резюме HH','resumes')]]);
  }
  async status(scope,id) {
    await this.transaction(scope,async(c,a)=>{
      const row=await this.load(c,scope,id,'change',{consumed:true});
      if(row.status!=='consumed'||stamp(a)!==changeSchema.parse(row.frozen).accessStamp)throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
    });
    const operation=await this.service.operation(scope.userId,id);
    await this.transaction(scope,async()=>{});return this.outcome(operation,id);
  }
  async handle({scope,context,action,targetId,index}) {
    if(action==='resumes'||action==='resumes_refresh')return this.menu(scope,context,action==='resumes_refresh');
    if(action==='rs_pick')return this.preview(scope,targetId,index);
    if(action==='rs_auto')return this.preview(scope,targetId,null,index===1);
    if(action==='rs_ok')return this.confirm(scope,targetId);
    if(action==='rs_status')return this.status(scope,targetId);
    return null;
  }
}
module.exports={JobResumeTelegram};
