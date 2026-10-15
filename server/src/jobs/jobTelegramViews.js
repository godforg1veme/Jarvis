function response(answer, buttons = []) {
  return { answer, ...(buttons.length ? { buttons } : {}), plainText: true, disableLinkPreview: true,
    historyAnswer: 'Поиск работы: результат действия показан владельцу.' };
}
function button(text, action, id) { return { text, data: `job:${action}${id == null ? '' : `:${id}`}` }; }
function homeView({ search, usage, connection }) {
  const enabled = search.settings.activated && !search.settings.paused;
  return response(`Поиск работы\n${enabled ? 'Поиск включён' : 'Поиск выключен'}
Проверка: каждые ${Math.round(search.settings.intervalMs / 60000)} мин.
Первая выдача: ${search.settings.historyDays} дней.
Последняя успешная проверка: ${search.checkpoint ? new Date(search.checkpoint).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'ещё не выполнена'}
API за ${usage.month}: $${Number(usage.total).toFixed(4)}${usage.pending ? `, ${usage.pending} запросов с уточняемой стоимостью` : ''}.
Уведомление: $${search.settings.budgetUsd}; работа после него продолжается.
HH: ${connection?.status === 'connected' ? connection.resume_id ? 'подключён, основное резюме выбрано' : 'нужно выбрать резюме' : 'не подключён'}.
${search.status === 'attention' ? 'Последняя проверка не завершена; сохранённый прогресс будет использован повторно.' : ''}`.trim(), [
    [button(enabled ? 'Выключить поиск' : 'Включить поиск', enabled ? 'pause' : 'resume')],
    [button('Настройки', 'settings'), button('Сохранённые', 'saved', 0)],
    [button('Отклики', 'applications', 0), button('Проверить сейчас', 'check')],
    [button('Профиль и примеры', 'profile'), button('Подключить HH', 'connect')],
    [button('Назад', 'back')],
  ]);
}
const ANNOTATIONS = { SALARY_UNKNOWN: 'Доход нужно уточнить', SALARY_NEEDS_CLARIFICATION: 'Налоги, период оплаты или премии нужно уточнить',
  SALARY_MINIMUM_NOT_GUARANTEED: '100 000 ₽ на руки не гарантированы', SALARY_CONFLICT: 'Суммы в описании и полях расходятся',
  REMOTE_ELIGIBILITY_UNKNOWN: 'Возможность работы из Москвы нужно уточнить', LOCATION_UNKNOWN: 'Место и формат нужно уточнить' };
function salaryText(salary) {
  if (!salary || (salary.from == null && salary.to == null)) return 'не указана';
  const format = (n) => Number(n).toLocaleString('ru-RU');
  return `${salary.from != null ? `от ${format(salary.from)}` : ''}${salary.to != null ? ` до ${format(salary.to)}` : ''} ${salary.currency || ''}; ${salary.gross === false ? 'на руки' : salary.gross === true ? 'до налогов' : 'налоги не уточнены'}${salary.period ? `; ${salary.period}` : ''}`.trim();
}
function cardView(vacancy) {
  const v = vacancy.snapshot;
  return response(`${v.title}\n${v.company || 'Компания не указана'}\nЗарплата: ${salaryText(v.salary)}
${v.city || 'Город не указан'} · ${{ remote: 'удалённо', office: 'офис', hybrid: 'гибрид' }[v.workFormat] || 'формат не уточнён'}
${v.employment || 'Занятость не уточнена'}
${descriptionSalary(v.description).slice(0, 3).map((salary) => `В описании: ${salaryText(salary)}`).join('\n')}
Опубликовано: ${new Date(v.publishedAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}
${(vacancy.annotations || []).map((code) => ANNOTATIONS[code]).filter(Boolean).join('\n')}
${v.url}`, [
    [{ text: 'Открыть вакансию', url: v.url }], [button('Подготовить отклик', 'prepare', vacancy.id)],
    [button('Сохранить', 'save', vacancy.id), button('Скрыть', 'hide', vacancy.id)],
  ]);
}
function draftView(draft) {
  return response(`Черновик сопроводительного\n\n${draft.text}\n\nПисьмо ещё не отправлено.`, [
    [button('Перегенерировать', 'regenerate', draft.id), button('Изменить', 'edit', draft.id)],
    [button('Перевести', 'translate', draft.id), button('Отправить отклик', 'send', draft.id)],
    [button('Отмена', 'cancel', draft.id)],
  ]);
}
function listView(rows, page, kind) {
  const buttons = rows.map((row) => [button(row.snapshot.title.slice(0, 55), 'view', row.id)]);
  const navigation = [];
  if (page > 0) navigation.push(button('Назад', kind, page - 1));
  if (rows.length === 10 && page < 9999) navigation.push(button('Дальше', kind, page + 1));
  if (navigation.length) buttons.push(navigation);
  buttons.push([button('В поиск работы', 'menu')]);
  return response(rows.length ? 'Выбери вакансию:' : 'Пока нет вакансий в этом списке.', buttons);
}
module.exports = { response, button, homeView, cardView, draftView, listView, salaryText };
const { descriptionSalary } = require('./salaryRules');
