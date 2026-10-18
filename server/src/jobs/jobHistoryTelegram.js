const {response,button}=require('./jobTelegramViews');
const employer={not_viewed:'Не просмотрен',viewed:'Просмотрен',invited:'Приглашение',rejected:'Отказ',unknown:'Статус HH не подтверждён'};
const sending={sending:'Отправка обрабатывается',sent:'Отправлен',unknown:'Результат отправки неизвестен',failed:'Ошибка отправки',manual_required:'Нужны дополнительные действия',already_applied:'Ранее найден отклик'};
const syncStatus={queued:'В очереди',running:'Обновляется',paused:'Проверка приостановлена; сохранённый прогресс продолжится',complete:'Проверка завершена',incomplete:'История прочитана не полностью',failed:'Проверка не завершена; сохранённые данные показаны ниже'};
const date=x=>x?new Date(x).toLocaleString('ru-RU',{timeZone:'Etc/GMT-3'}):'неизвестно';
function summary(s,available){
  if(!available)return'Чтение истории HH не настроено. Показан журнал Jarvis.';
  if(!s)return'Для загрузки истории подключи HH и нажми «Обновить из HH».';
  return `${syncStatus[s.status]}\nПоследняя полная проверка: ${s.last_success_at?date(s.last_success_at):'ещё не завершена'}.${s.status==='paused'&&/CAPTCHA|MANUAL/.test(s.failure_code||'')?' Пройди проверку HH через фото в Telegram.':''}`;
}
class JobHistoryTelegram{
  constructor({repository,syncRepository,available=false}){Object.assign(this,{repository,syncRepository,available});}
  async request(scope,firstOnly=false){
    if(!this.available)return;
    try{await this.syncRepository.request({scope,firstOnly});}catch(e){if(e.code!=='JOB_HH_NOT_CONNECTED'||!firstOnly)throw e;}
  }
  async handle({scope,action,targetId,page=0}){
    if(!['applications','applications_sync','application','application_refresh'].includes(action))return null;
    let row;
    if(action==='application'||action==='application_refresh')row=await this.repository.get({scope,id:targetId});
    if(action==='applications')await this.request(scope,true);
    if(action==='applications_sync'||action==='application_refresh')await this.request(scope);
    const state=await this.syncRepository.state(scope);
    if(row){
      const origin=row.origin==='hh'?'Обнаружен на HH':row.send_status==='sent'?'Отправлен через Jarvis':'Операция Jarvis';
      const oldStatus=row.status_checked_at&&row.checked_at&&new Date(row.checked_at)>new Date(row.status_checked_at);
      const text=`${row.title||'Вакансия HH'}\n${row.company||'Компания не указана'}\nИсточник: ${origin}.
Резюме: ${row.resume_title||'название недоступно'}.
${row.applied_at?`Дата отклика HH: ${date(row.applied_at)}`:row.row_kind==='local'?`Дата отправки HH неизвестна. Операция Jarvis начата: ${date(row.first_seen_at)}`:`Дата отправки неизвестна. Обнаружен: ${date(row.first_seen_at)}`}
Отправка Jarvis: ${row.send_status?sending[row.send_status]:'не выполнялась'}.
HH: ${employer[row.employer_status]}. Проверено: ${date(row.status_checked_at)}.
${oldStatus?'При последнем чтении статус не распознан; выше показан прежний подтверждённый результат.':''}
${row.vacancy_archived?'Вакансия закрыта или недоступна; это не означает отказ.':''}
${summary(state,this.available)}
${row.events.length?'\nНаблюдения:\n'+row.events.map(e=>`${date(e.observed_at)} — ${employer[e.employer_status]}`).join('\n'):''}
${row.approved_text?'\nСогласованный текст письма:\n'+row.approved_text:'\nТекст прежнего письма из HH не загружался.'}`;
      return response(text.trim(),[[{text:'Открыть вакансию',url:`https://hh.ru/vacancy/${row.external_vacancy_id}`}],
        ...(this.available?[[button('Обновить статус','application_refresh',row.id)]]:[]),
        [button('Показать текущие данные','application',row.id)],[button('К списку откликов','applications',0)]]);
    }
    const result=await this.repository.list({scope,page});
    const buttons=result.items.map(r=>[button(`${(r.title||'Вакансия HH').slice(0,35)} · ${r.employer_status==='unknown'?(sending[r.send_status]||'найден на HH'):employer[r.employer_status]}`.slice(0,64),'application',r.id)]);
    const nav=[];if(page>0)nav.push(button('Назад','applications',page-1));if(page<9999&&(page+1)*10<result.total)nav.push(button('Дальше','applications',page+1));if(nav.length)buttons.push(nav);
    if(this.available)buttons.push([button('Обновить из HH','applications_sync')]);buttons.push([button('В поиск работы','menu')]);
    const entries=result.items.map((r,i)=>`${page*10+i+1}. ${(r.title||'Вакансия HH').slice(0,60)} · ${(r.company||'Компания не указана').slice(0,40)}\n${r.origin==='hh'?'Обнаружен на HH':r.send_status==='sent'?'Отправлен через Jarvis':'Операция Jarvis'} · HH: ${employer[r.employer_status]}${r.send_status?` · ${sending[r.send_status]}`:''}`).join('\n\n');
    return response(`Отклики: ${result.total}\n${summary(state,this.available)}\n\n${entries||'Пока нет записей. Импорт сохраняет и старые отклики HH.'}${entries?'\n\nВыбери отклик:':''}`,buttons);
  }
}
module.exports={JobHistoryTelegram};
