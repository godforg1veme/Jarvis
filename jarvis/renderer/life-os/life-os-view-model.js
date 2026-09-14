(function lifeOsViewModelModule() {
  const MODES = Object.freeze([
    ['work', 'Работа'], ['focus', 'Фокус'], ['home', 'Дом'], ['family', 'Семья'], ['meeting', 'Встреча'],
    ['travel', 'Поездка'], ['rest', 'Отдых'], ['sleep', 'Сон'], ['emergency', 'Экстренно'],
  ]);
  const SOURCES = Object.freeze([
    ['calendar', 'Календарь', 'Сроки, встречи и свободные окна'],
    ['email', 'Почта', 'Только безопасные метаданные важных писем'],
    ['tasks', 'Задачи', 'Состояние задач и напоминаний'],
    ['receipts', 'Чеки и счета', 'Сумма, продавец, дата и статус'],
    ['deliveries', 'Доставки', 'Этап и ожидаемое время доставки'],
    ['travel', 'Билеты', 'Маршрут, время и статус бронирования'],
    ['subscriptions', 'Подписки', 'Регулярные списания и продления'],
    ['smart_home', 'Умный дом', 'Только значимые агрегированные сигналы'],
  ]);
  const PREFERENCES = Object.freeze([
    { key: 'response.style', label: 'Стиль ответа', type: 'select', options: [['concise', 'Кратко'], ['balanced', 'Сбалансированно'], ['detailed', 'Подробно']], fallback: 'balanced' },
    { key: 'contextual_adaptation.enabled', label: 'Контекстная адаптация', type: 'boolean', fallback: true },
    { key: 'initiative.level', label: 'Инициативность', type: 'select', options: [['minimal', 'Минимальная'], ['normal', 'Нормальная'], ['high', 'Высокая']], fallback: 'normal' },
    { key: 'notifications.max_proactive_per_day', label: 'Предложений в день', type: 'number', min: 0, max: 50, fallback: 5 },
    { key: 'links.low_confidence_behavior', label: 'Неуверенные связи', type: 'select', options: [['ask', 'Уточнять'], ['show', 'Показывать'], ['ignore', 'Игнорировать']], fallback: 'ask' },
    { key: 'reminders.default_lead_minutes', label: 'Напоминать заранее, мин', type: 'number', min: 0, max: 10080, fallback: 60 },
  ]);
  const REASONS = Object.freeze({
    'user.weight': 'ваш явный приоритет', 'area.weight': 'важность области', 'deadline.today': 'срок сегодня',
    'commitments.open': 'есть открытые договорённости', 'commitments.overdue': 'есть просрочка',
    'activity.today': 'активность сегодня', 'workflow.unresolved': 'незавершённое действие',
    'mode.work': 'соответствует режиму Работа', 'mode.focus': 'соответствует режиму Фокус',
    'resource.available': 'Desktop готов к действиям', 'user.pin': 'закреплено вами',
  });
  const STATUS = Object.freeze({
    active: 'активен', paused: 'на паузе', completed: 'завершён', open: 'открыто', scheduled: 'запланировано',
    delivered: 'доставлено', failed: 'ошибка', outcome_unknown: 'результат неизвестен', online: 'онлайн', offline: 'офлайн',
    ready: 'готов', awaiting_confirmation: 'ждёт подтверждения', executing: 'выполняется', partial: 'частично', fresh: 'актуально',
  });
  function reasonLabel(reason) { return REASONS[reason?.code] || String(reason?.code || 'контекстный сигнал').replaceAll('_', ' '); }
  function statusLabel(value) { return STATUS[value] || String(value || 'неизвестно').replaceAll('_', ' '); }
  function isStale(asOf, now = Date.now()) { const time = Date.parse(asOf || ''); return Number.isFinite(time) && now - time > 5 * 60 * 1000; }
  function preferenceMap(items) { return new Map((items || []).map((item) => [item.key, item])); }
  window.JarvisLifeOsViewModel = { MODES, PREFERENCES, SOURCES, isStale, preferenceMap, reasonLabel, statusLabel };
}());
