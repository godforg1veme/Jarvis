import { readPending, savePending, clearPending } from './api.js';
const KIND='job-resumes';
const date=value=>value?new Intl.DateTimeFormat('ru-RU',{timeZone:'Etc/GMT-3',dateStyle:'short',timeStyle:'short'}).format(new Date(value))+' МСК':'ещё не было';
function make(tag,text,className) {const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;}
export function createJobResumePanel({api,actor,parent}) {
  let data=null,disposed=false,connected=false,busy=false,dirty=false,stale=false,timer=null,pending=readPending(actor,KIND),preview=null,inspection=null;
  const root=make('div',null,'job-resume-manager');root.hidden=true;
  const title=make('h3','Мои резюме HH'),status=make('p','Загружаем резюме…','muted');status.setAttribute('aria-live','polite');
  const label=make('label','Основное резюме для откликов'),select=make('select');select.setAttribute('aria-label','Резюме для откликов');label.append(select);
  const currentTitle=make('p',null,'muted');
  const toggleLabel=make('label',null,'job-resume-toggle'),toggle=make('input');toggle.type='checkbox';toggle.setAttribute('aria-label','Автоподнятие выбранного резюме');
  toggleLabel.append(toggle,make('span','Поднимать выбранное резюме автоматически'));
  const hint=make('p','Для новых подключений автоподнятие включено по умолчанию; его можно выключить. Только бесплатно, не чаще раза в 4 часа и когда HH разрешает. Остальные резюме и их видимость не меняются.','muted');
  const help=make('details',null,'job-resume-help'),helpTitle=make('summary','Бесплатно, не чаще раза в 4 часа');help.append(helpTitle,hint);
  const details=make('p',null,'muted'),buttons=make('div',null,'job-controls'),confirmBox=make('div',null,'job-resume-confirm');confirmBox.hidden=true;
  const confirmText=make('p');confirmBox.append(confirmText);
  const btn=(parent,text,fn,primary=false)=>{const b=make('button',text,primary?'primary':'secondary');b.type='button';b.onclick=()=>{Promise.resolve(fn()).catch(e=>message(e.message||'Не удалось выполнить действие.'));};parent.append(b);return b;};
  const save=btn(buttons,'Проверить изменения',showPreview,true),refresh=btn(buttons,'Обновить из HH',()=>refreshList());
  const reconcile=btn(buttons,'Проверить исходный запрос',checkPending);reconcile.hidden=!pending;
  const checkRaise=btn(buttons,'Проверить последнее поднятие',checkLastRaise);checkRaise.hidden=true;
  const manual=make('details',null,'job-resume-help');manual.hidden=true;
  const manualTitle=make('summary','Как сверить неизвестный результат HH');
  const manualHint=make('p','Проверь исходную операцию: Jarvis прочитает состояние твоего подключённого профиля HH. Если результат не подтверждён, изменения останутся заблокированы. Ничего повторно не отправляется.','muted');
  const manualResult=make('p',null,'muted');manualResult.setAttribute('role','status');
  const manualLink=make('a','Открыть мои резюме в HH','secondary');manualLink.href='https://hh.ru/applicant/resumes';manualLink.target='_blank';manualLink.rel='noopener noreferrer';
  const manualCheck=btn(manual,'Сверить исходную операцию с HH',inspectOriginal);
  const manualConfirm=btn(manual,'Подтвердить сверку',confirmOriginal,true);manualConfirm.hidden=true;
  manual.append(manualTitle,manualHint,manualResult,manualCheck,manualConfirm,manualLink);
  const accept=btn(confirmBox,'Подтвердить',commit,true),cancel=btn(confirmBox,'Отмена',()=>{preview=null;confirmBox.hidden=true;controls();});
  root.append(title,status,label,currentTitle,toggleLabel,help,details,buttons,confirmBox,manual);parent.append(root);
  function message(text) {if(!disposed)status.textContent=text;}
  function controls() {
    root.dataset.state=busy?'pending':pending?'unknown':preview?'confirmation':data?.autoRaise?.lastOutcome==='unknown'?'unknown':'ready';
    root.setAttribute('aria-busy',String(busy));
    const blocked=busy||Boolean(pending)||Boolean(preview)||stale;
    save.disabled=blocked||!dirty||!select.value;refresh.disabled=busy||Boolean(pending)||Boolean(preview);
    select.disabled=busy||Boolean(pending)||Boolean(preview);toggle.disabled=select.disabled||!data?.raiseAvailable||data?.autoRaise?.lastOutcome==='unknown';
    accept.disabled=busy;cancel.disabled=busy;reconcile.hidden=!pending;reconcile.disabled=busy;
    checkRaise.hidden=data?.autoRaise?.lastOutcome!=='unknown'||!data?.autoRaise?.lastOperationId;checkRaise.disabled=busy||Boolean(pending);
    manual.hidden=!pending&&data?.autoRaise?.lastOutcome!=='unknown';manualCheck.disabled=busy;
    manualConfirm.hidden=!inspection||inspection.id!==pending;manualConfirm.disabled=busy||!connected;
  }
  select.onchange=toggle.onchange=()=>{dirty=true;controls();};
  function render(next) {
    if(disposed)return;
    if(dirty&&data&&(data.revision!==next.revision||data.connectionRevision!==next.connectionRevision)) {
      stale=true;message('Выбор изменился в другой вкладке. Нажми «Обновить из HH», чтобы загрузить актуальный профиль.');controls();return;
    }
    const wanted=dirty?select.value:next.primaryResumeId;
    data=next;select.replaceChildren();
    const blank=make('option',next.resumes?.length?'Выбери резюме':'HH не вернул резюме');blank.value='';blank.disabled=true;select.append(blank);
    for(const r of next.resumes||[]) {const o=make('option',`${r.title}${r.id===next.primaryResumeId?' · основное':''}`);o.value=r.id;select.append(o);}
    select.value=(next.resumes||[]).some(r=>r.id===wanted)?wanted:'';
    currentTitle.textContent=`Сейчас используется: ${(next.resumes||[]).find(r=>r.id===next.primaryResumeId)?.title||'ранее выбранное резюме недоступно'}.`;
    if(!dirty)toggle.checked=Boolean(next.autoRaise?.enabled);
    if(next.autoRaise?.lastOutcome==='unknown')toggle.checked=false;
    details.textContent=`Список обновлён: ${date(next.updatedAt)}.\nПоследнее поднятие: ${date(next.autoRaise?.lastAt)}.\nСледующая проверка поднятия: ${date(next.autoRaise?.nextAt)}.`;
    message(next.autoRaise?.lastOutcome==='unknown'?'Автоподнятие остановлено: результат последней попытки нужно проверить вручную.'
      :next.autoRaise?.lastOutcome==='failed'?'Последняя попытка поднятия не выполнена. Проверь подключение HH; следующая проверка указана ниже.'
        :next.autoRaise?.lastOutcome==='ineligible'?'Для выбранного резюме бесплатное поднятие сейчас недоступно.'
          :next.autoRaise?.lastOutcome==='not_due'?'HH ещё не разрешает поднятие. Следующая проверка указана ниже.'
      :next.lastError?'Не удалось обновить HH. Показан последний сохранённый список.'
        :!next.raiseAvailable?'Выбор резюме доступен. Автоподнятие пока не настроено на сервере.'
          :!select.value?'Выбранное ранее резюме недоступно. Выбери другое и подтверди.':'Используется отмеченное основное резюме. Список также обновляется в фоне каждые 15 минут.');
    controls();
  }
  async function load() {
    if(disposed||!connected)return;
    const next=await api.request('/jobs/resumes');if(!disposed)render(next);
    if(!next.updatedAt&&!busy&&!pending&&!dirty)await refreshList(false);
  }
  async function refreshList(discard=true) {
    if(busy||pending||disposed)return;
    if(discard){dirty=false;stale=false;preview=null;confirmBox.hidden=true;}
    const id=crypto.randomUUID();savePending(actor,KIND,id);pending=id;busy=true;controls();message('Обновляем список из твоего HH…');
    try {
      const op=await api.request('/jobs/resumes/refresh','POST',{requestId:id});
      if(op.status==='complete'||op.status==='failed'){clearPending(actor,KIND,id);pending=null;}
      await load();
    } catch(e) {if(!e.uncertain){clearPending(actor,KIND,id);pending=null;}message(e.message||'HH временно недоступен. Последний список сохранён.');}
    finally {busy=false;controls();}
  }
  function showPreview() {
    if(!data||!select.value||busy||pending||stale)return;
    const r=data.resumes.find(r=>r.id===select.value);if(!r)return;
    preview={expectedRevision:data.revision,connectionRevision:data.connectionRevision,resumeId:r.id,autoRaiseEnabled:toggle.checked};
    confirmText.textContent=`Основное резюме: «${r.title}».\nАвтоподнятие: ${toggle.checked?'включить для этого резюме, не чаще раза в 4 часа':'выключить'}.\nПодготовленные подтверждения откликов с другим резюме станут неактуальны.`;
    confirmBox.hidden=false;controls();
  }
  async function commit() {
    if(!preview||busy||pending)return;
    const id=crypto.randomUUID();savePending(actor,KIND,id);pending=id;busy=true;controls();message('Сохраняем настройки резюме…');
    try {
      const op=await api.request('/jobs/resumes/settings','POST',{requestId:id,...preview});
      if(op.status==='complete'||op.status==='failed') {
        clearPending(actor,KIND,id);pending=null;dirty=false;preview=null;confirmBox.hidden=true;await load();
      } else message('Результат ещё не подтверждён. Проверь исходный запрос; повторная смена не отправлена.');
    } catch(e) {
      if(!e.uncertain){clearPending(actor,KIND,id);pending=null;preview=null;confirmBox.hidden=true;stale=true;}
      message(e.message||'Результат неизвестен. Проверь исходный запрос.');
    } finally {busy=false;controls();}
  }
  async function checkPending() {
    if(!pending||busy)return;busy=true;controls();
    try {
      const op=await api.request(`/jobs/resumes/operations/${encodeURIComponent(pending)}`);
      if(['complete','failed'].includes(op.status)){clearPending(actor,KIND,pending);pending=null;dirty=false;stale=false;preview=null;confirmBox.hidden=true;await load();}
      else message('Исходный запрос ещё не завершён. Новое действие не отправлено.');
    } catch(e){message(e.message||'Пока не удалось проверить исходный запрос.');}
    finally{busy=false;controls();}
  }
  async function checkLastRaise() {
    if(busy||pending||!data?.autoRaise?.lastOperationId)return;busy=true;controls();
    try {
      const op=await api.request(`/jobs/resumes/operations/${encodeURIComponent(data.autoRaise.lastOperationId)}`);
      if(op.status==='complete')await load();
      else message('Сохранённого подтверждения ещё нет. Автоподнятие остаётся выключенным; проверь резюме в HH вручную. Повтор не отправлен.');
    } catch(e){message(e.message||'Не удалось проверить сохранённый результат.');}
    finally{busy=false;controls();}
  }
  async function inspectOriginal() {
    const id=pending||(data?.autoRaise?.lastOutcome==='unknown'?data.autoRaise.lastOperationId:null);
    if(!id||busy||disposed||!connected)return;
    inspection=null;busy=true;controls();manualResult.textContent='Читаем сохранённый результат исходной операции…';
    try {
      const op=await api.request(`/jobs/resumes/operations/${encodeURIComponent(id)}/inspection`);
      if(disposed||!connected)return;
      const info=op.inspection||{};
      const target=info.targetTitle?`«${info.targetTitle}» (${info.targetResumeId||''})`:info.targetResumeId||'неизвестно';
      manualResult.textContent=`Исходная операция: ${id}. Резюме: ${target}. Автоподнятие: ${info.autoRaiseEnabled?'включить':'выключить'}. ${['complete','failed'].includes(op.status)?'Получен конечный результат.':info.selectionVerified?'HH показывает исходное резюме. Подтверди сверку, чтобы завершить сохранённый запрос.':'Результат пока не подтверждён. Смена резюме и повторное поднятие не отправлялись; блокировка сохраняется.'}`;
      if(op.status==='unknown'&&info.selectionVerified&&info.accessChanged&&info.confirmationRevision&&pending===id)
        inspection={id,revision:info.confirmationRevision};
      if(['complete','failed'].includes(op.status)){
        if(pending===id){clearPending(actor,KIND,id);pending=null;dirty=false;stale=false;preview=null;confirmBox.hidden=true;}
        await load();
      }
    }catch(error){message(error.message||'Сверка недоступна. Исходная операция и блокировка сохранены.');}
    finally{busy=false;controls();}
  }
  async function confirmOriginal() {
    const checked=inspection;
    if(!checked||checked.id!==pending||busy||disposed||!connected)return;
    inspection=null;busy=true;controls();message('Подтверждаем сверку исходной операции…');
    try {
      const op=await api.request(`/jobs/resumes/operations/${encodeURIComponent(checked.id)}/confirm-inspection`,'POST',
        {confirmed:true,confirmationRevision:checked.revision});
      if(disposed||!connected)return;
      if(op.status==='complete') {
        clearPending(actor,KIND,checked.id);pending=null;dirty=false;stale=false;preview=null;confirmBox.hidden=true;
        manualResult.textContent='Сверка подтверждена. Исходный запрос завершён без повторной отправки в HH.';
        await load();
      } else message('Сверка не завершена. Исходный запрос остаётся заблокированным.');
    }catch(error){if(!disposed&&connected)message(error.message||'Сверка устарела. Повтори чтение исходной операции.');}
    finally{busy=false;controls();}
  }
  const visibility=()=>{if(!document.hidden&&connected&&!busy)void load().catch(e=>message(e.message));};document.addEventListener('visibilitychange',visibility);
  return {
    show(){if(disposed)return;root.hidden=false;if(connected)return;connected=true;void load().then(()=>pending?checkPending():null).catch(e=>message(e.message));
      timer=setInterval(()=>{if(!document.hidden&&!busy)void load().catch(e=>message(e.message));},60000);},
    hide(){connected=false;inspection=null;root.hidden=true;clearInterval(timer);timer=null;},
    dispose(){disposed=true;inspection=null;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);root.remove();},
  };
}
