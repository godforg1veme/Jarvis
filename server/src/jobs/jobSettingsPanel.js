const { settingsSchema, jobError, assertJobScope } = require('./jobSchemas');
const { isDeepStrictEqual } = require('node:util');
const { response, button } = require('./jobTelegramViews');
const { fields, listFields, formatValue, parseValue, choices } = require('./jobSettingsControls');

const control = (text, action, field, revision, index=0) => ({text,data:`job:${action}:${field}:${revision}:${index}`});
const short = (value, size=55) => value.length>size?`${value.slice(0,size-1)}…`:value;

class JobSettingsPanel {
  constructor(jobs) { this.jobs=jobs; }
  async current(scope,revision,targetId) {
    const search=await this.jobs.searchRepository.getSettings({userId:scope.userId});
    if(!search || revision!==undefined&&search.revision!==revision || targetId&&search.id!==targetId) throw jobError('JOB_REVISION_CONFLICT');
    return search;
  }
  panel(search, notice='') {
    const s=search.settings;
    const rows=Object.entries(fields).map(([field,def])=>{
      const value=listFields.includes(field)?s[def.key].length:field==='model'?'':formatValue(field,s[def.key]);
      return [control(short(`${def.label}${value!==''?`: ${value}`:''}`),'cfg',field,search.revision)];
    });
    rows.push([button('← В поиск работы','menu')]);
    return response(`${notice?notice+'\n\n':''}⚙️ Настройки поиска\nНажми на параметр, чтобы изменить его.\nДоход — ориентир на руки. Уведомление о расходах не останавливает AI.`,rows);
  }
  fieldView(search,field,page=0,notice='') {
    const def=fields[field],s=search.settings,rev=search.revision;
    if(listFields.includes(field)) {
      const list=s[def.key],last=Math.max(0,Math.ceil(list.length/8)-1),p=Math.min(page,last);
      const rows=list.slice(p*8,p*8+8).map((text,i)=>[control(short(`${p*8+i+1}. ${text}`),'cfg_item',field,rev,p*8+i)]);
      if(list.length<(field==='queries'?100:50)) rows.push([control('＋ Добавить','cfg_input',field,rev,p)]);
      const nav=[];if(p>0)nav.push(control('← Назад','cfg',field,rev,p-1));if(p<last)nav.push(control('Дальше →','cfg',field,rev,p+1));if(nav.length)rows.push(nav);
      rows.push([button('← В настройки','settings')]);
      return response(`${notice?notice+'\n\n':''}${def.label}: ${list.length}\nСтраница ${p+1} из ${last+1}\n${list.length?'Нажми на фразу, чтобы увидеть её полностью или удалить.':'Пока нет фраз.'}`,rows);
    }
    const options=choices(field,s,this.jobs.settingsModels);
    const rows=options.map((x,i)=>[control(short(`${Object.is(s[def.key],x.value)?'✓ ':''}${x.label}`),'cfg_pick',field,rev,i)]);
    if(field!=='remote') rows.push([control(field==='model'?'Указать другую':field==='city'?'Изменить город':'Ввести своё','cfg_input',field,rev)]);
    rows.push([button('← В настройки','settings')]);
    const current=field==='model'&&!s.model?`По умолчанию (${this.jobs.defaultModel||'не настроена'})`:formatValue(field,s[def.key]);
    return response(`${def.label}\nСейчас: ${current}\n\n${def.hint}${field==='model'?'\nПоказаны текущая и настроенные модели; это не полный каталог OpenRouter.':''}`,rows);
  }
  async destination(scope,returnTo,notice) {
    const search=await this.current(scope);
    return returnTo.field==='panel'?this.panel(search,notice):this.fieldView(search,returnTo.field,returnTo.page,notice);
  }
  async preview(scope,search,field,next,change,page=0) {
    next=settingsSchema.parse(next);
    const returnTo={field:listFields.includes(field)?field:'panel',page};
    if(isDeepStrictEqual(next,search.settings)) return this.destination(scope,returnTo,'Это значение уже установлено.');
    const confirmation=await this.jobs.settingsService.preview({scope,kind:'settings',targetId:search.id,revision:search.revision,value:next,returnTo});
    return response(`Проверь изменение\n\n${change}\n\nСохранить?`,[[button('Сохранить','cfg_ok',confirmation.id)],
      [listFields.includes(field)?control('Отмена','cfg',field,search.revision,page):button('Отмена','settings')]]);
  }
  async handle({scope,action,field,revision,page=0,index,targetId}) {
    if(action==='settings') return this.panel(await this.current(scope));
    if(!['cfg','cfg_input','cfg_pick','cfg_item','cfg_remove','cfg_ok'].includes(action)) return null;
    if(action==='cfg_ok') {
      const saved=await this.jobs.settingsService.approve({scope,confirmationId:targetId,panel:true});
      return this.destination(scope,saved.returnTo,'✓ Изменения сохранены.');
    }
    const search=await this.current(scope,revision),s=search.settings,def=fields[field];
    if(!def) throw jobError('JOB_INVALID_ACTION');
    if(action==='cfg') return this.fieldView(search,field,page);
    if(action==='cfg_input') {
      await this.jobs.interactions.begin({...scope,channel:undefined,kind:'job_setting_value',context:{targetId:search.id,revision:search.revision,field,returnPage:page}});
      return response(`${def.label}\n${def.hint}\nПеред сохранением покажу изменение.`,
        [[listFields.includes(field)?control('Отмена','cfg',field,search.revision,page):button('Отмена','settings')]]);
    }
    if(action==='cfg_pick') {
      const choice=choices(field,s,this.jobs.settingsModels)[index];
      if(!choice) throw jobError('JOB_INVALID_ACTION');
      return this.preview(scope,search,field,{...s,[def.key]:choice.value},`${def.label}: ${formatValue(field,s[def.key])} → ${formatValue(field,choice.value)}`);
    }
    if(!listFields.includes(field)||index>=s[def.key].length) throw jobError('JOB_NOT_FOUND');
    const text=s[def.key][index],returnPage=Math.floor(index/8);
    if(action==='cfg_item') return response(`${def.label}\n\n${text}`,[[control('Удалить','cfg_remove',field,revision,index)],[control('← К списку','cfg',field,revision,returnPage)]]);
    if(field==='queries'&&s.queries.length===1) return this.fieldView(search,field,returnPage,'Нельзя удалить последний запрос. Сначала добавь другой.');
    return this.preview(scope,search,field,{...s,[def.key]:s[def.key].filter((_,i)=>i!==index)},`Удалить фразу:\n${text}`,returnPage);
  }
  async handlePendingText(text,{scope,interaction}) {
    if(interaction.kind!=='job_setting_value') return null;
    await assertJobScope(this.jobs.pool,scope);
    const {targetId,revision,field,returnPage}=interaction.context;
    const search=await this.current(scope,revision,targetId),def=fields[field];
    let value;
    try { value=parseValue(field,text); } catch(error) {
      return response(error.code==='JOB_SENSITIVE_INPUT'?'Не присылай ключи и пароли. Введи только значение настройки.':`Не удалось принять значение. ${def.hint}`,
        [[listFields.includes(field)?control('Отмена','cfg',field,revision,returnPage):button('Отмена','settings')]]);
    }
    let destinationPage=returnPage;
    let next={...search.settings,[def.key]:value},change=`${def.label}: ${formatValue(field,search.settings[def.key])} → ${formatValue(field,value)}`;
    if(listFields.includes(field)) {
      const old=search.settings[def.key];
      if(old.length>=(field==='queries'?100:50)&&!old.includes(value)) return response('Список заполнен. Удали одну фразу перед добавлением.',[[control('← К списку','cfg',field,revision,returnPage)]]);
      next={...search.settings,[def.key]:old.includes(value)?old:[...old,value]};change=`Добавить фразу:\n${value}`;
      if(!old.includes(value)) destinationPage=Math.floor(old.length/8);
    }
    const consumed=await this.jobs.interactions.consume({id:interaction.id,...scope});
    if(!consumed) throw jobError('JOB_CONFIRMATION_UNAVAILABLE');
    return this.preview(scope,search,field,next,change,destinationPage);
  }
}
module.exports={JobSettingsPanel};
