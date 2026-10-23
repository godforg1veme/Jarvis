const { settingsSchema, jobError } = require('./jobSchemas');

const fields = Object.freeze({
  salary: { key:'targetRub', label:'💰 Доход', hint:'Ориентир дохода на руки в рублях: целое от 1 до 100 000 000. Можно снять ограничение кнопкой.', presets:[80000,100000,150000,200000,null] },
  city: { key:'officeCity', label:'📍 Город', hint:'Пришли название города для офисных вакансий, до 120 символов. Можно выбрать любой город.' },
  remote: { key:'remote', label:'🏠 Удалённые вакансии', hint:'Любой формат — без ограничения. «Да» допускает удалённые вакансии наряду с офисными; «нет» исключает удалённые.', presets:[true,false,null] },
  interval: { key:'intervalMs', label:'🕒 Проверять', hint:'Интервал проверки в минутах: целое от 1 до 1440.', presets:[900000,1800000,3600000,7200000] },
  history: { key:'historyDays', label:'📅 История', hint:'Глубина первоначальной выдачи: от 1 до 30 дней. Это не срок хранения откликов.', presets:[1,7,14,30] },
  budget: { key:'budgetUsd', label:'🔔 Уведомление о расходах', hint:'Порог уведомления в USD: больше 0, до 10 000. Он не останавливает расходы AI.', presets:[1,3,5,10] },
  queries: { key:'queries', label:'🔎 Поисковые запросы', hint:'Пришли ключевые слова или фразы одним сообщением: каждая фраза с новой строки, от 2 до 200 символов. Например:\nМенеджер по закупкам\nСнабжение\nЛогистика\nВсего до 100 фраз. Повторы не добавляются.' },
  exclusions: { key:'exclusions', label:'🚫 Исключения', hint:'Пришли нежелательные слова или фразы одним сообщением: каждая с новой строки, от 1 до 100 символов. Всего до 50 фраз. Повторы не добавляются.' },
});
const inputFields = Object.keys(fields).filter(x => x !== 'remote');
const listFields = ['queries','exclusions'];
function formatValue(field,value) {
  if(field==='salary'&&value===null) return 'Не задан';
  if(field==='city'&&!value) return 'Любой город';
  if(field==='remote'&&value===null) return 'Любой формат';
  if(field==='salary') return `${Number(value).toLocaleString('ru-RU')} ₽`;
  if(field==='interval') return `${value/60000} мин`;
  if(field==='history') return `${value} дн`;
  if(field==='budget') return `$${value}`;
  if(field==='remote') return value?'да':'нет';
  return value || 'По умолчанию';
}
function parseValue(field,input) {
  if(!inputFields.includes(field) || typeof input!=='string') throw jobError('JOB_INVALID_SETTING_VALUE');
  const text=input.trim();
  if(text.length>10000) throw jobError('JOB_INVALID_SETTING_VALUE');
  if(/\b(?:sk-[\w-]{16,}|Bearer\s+\S+)|(?:пароль|password|api[_ -]?key|токен)\s*[:=]\s*\S+/iu.test(text)) throw jobError('JOB_SENSITIVE_INPUT');
  if(listFields.includes(field)) {
    const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(!lines.length||lines.some(line=>/[\u0000-\u001f\u007f]/.test(line))) throw jobError('JOB_INVALID_SETTING_VALUE');
    const values=[...new Set(lines)];
    const parsed=settingsSchema.shape[fields[field].key].safeParse(values);
    if(!parsed.success) throw jobError('JOB_INVALID_SETTING_VALUE');
    return parsed.data;
  }
  if(/[\r\n\u0000-\u001f]/.test(text)) throw jobError('JOB_INVALID_SETTING_VALUE');
  let value=text;
  if(['salary','interval','history','budget'].includes(field)) {
    const compact=text.replace(/[ \u00a0\u202f]/g,'');
    if(!(field==='budget'?/^\d+(?:[.,]\d+)?$/:/^\d+$/).test(compact)) throw jobError('JOB_INVALID_SETTING_VALUE');
    value=Number(compact.replace(',','.'))*(field==='interval'?60000:1);
  }
  const parsed=settingsSchema.shape[fields[field].key].safeParse(value);
  if(!parsed.success) throw jobError('JOB_INVALID_SETTING_VALUE');
  return parsed.data;
}
function choices(field,settings) {
  if(listFields.includes(field)) return [{value:[],label:'Очистить список'}];
  if(field==='city') return [{value:'',label:'Любой город'}];
  return (fields[field]?.presets||[]).map(value=>({value,label:formatValue(field,value)}));
}
function parseSettingsCallback(value) {
  const match=/^job:(cfg|cfg_input|cfg_pick|cfg_item|cfg_remove):([a-z]+):([1-9]\d{0,9}):(\d{1,3})$/.exec(value);
  if(!match) return null;
  const [,action,field,rev,n]=match,revision=Number(rev),index=Number(n);
  if(!Object.hasOwn(fields,field)||revision>2147483647) return null;
  if(['cfg','cfg_input'].includes(action)) {
    if(index>12||action==='cfg_input'&&!inputFields.includes(field)) return null;
    return {action,field,revision,page:index};
  }
  if(['cfg_item','cfg_remove'].includes(action)&&!listFields.includes(field)||index>99) return null;
  return {action,field,revision,index};
}
module.exports={fields,inputFields,listFields,formatValue,parseValue,choices,parseSettingsCallback};
