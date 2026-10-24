function collectionNoticeView(code) {
  if (code !== 'INCOMPLETE') return null;
  return {
    answer: 'Поиск вакансий пока не завершён. Прогресс сохранён; повторю проверку автоматически. Уже найденные вакансии остаются доступны.',
    disableLinkPreview: true,
    buttons: [[{ text: 'В поиск работы', data: 'job:menu' }]],
  };
}
const COLLECTION_FAILURE_CODES = new Set([
  'JOB_COLLECTION_WINDOW_SATURATED', 'JOB_COLLECTION_WINDOW_EXPIRED',
  'JOB_HH_DOM_CHANGED', 'JOB_HH_INVALID_RESPONSE', 'JOB_HH_UNAVAILABLE',
  'JOB_HH_ACCESS_DENIED', 'JOB_COLLECTION_FAILED',
]);
module.exports = { collectionNoticeView, COLLECTION_FAILURE_CODES };
