const sectionInfo = {
  memory: {
    label: 'Память',
    capabilities: 'Здесь можно просматривать память. Добавление, исправление и удаление записей доступны в боте.',
    empty: 'В памяти пока нет записей.',
    hint: 'Здесь появятся твои сохранённые записи.',
    icon: 'memory',
  },
  documents: {
    label: 'Документы',
    capabilities: 'Здесь показаны твои документы и их состояние. Добавление и удаление документов доступны в боте.',
    empty: 'Документов пока нет.',
    hint: 'Здесь появятся твои документы.',
    icon: 'documents',
  },
  devices: {
    label: 'Устройства',
    capabilities: 'Здесь показаны подключённые устройства. Подключение компьютера и команды доступны в боте.',
    empty: 'Устройств пока нет.',
    hint: 'Здесь появятся твои подключённые устройства.',
    icon: 'devices',
  },
  life: {
    label: 'Life OS',
    capabilities: 'Здесь показаны миссия и договорённости. Напоминания и другие действия Life OS доступны в боте.',
    empty: 'В Life OS пока нет записей.',
    hint: 'Здесь появятся твои миссии и договорённости.',
    icon: 'life',
  },
  jobs: { label: 'Поиск работы', capabilities: 'Здесь можно подключить HH и настроить резюме. Вакансии, фильтры, письма и отклики доступны в боте.' },
  vpn: { label: 'VPN', icon: 'vpn', capabilities: 'Подписки и действия VPN доступны владельцу в личном чате с ботом. Изменения требуют подтверждения.' },
  operations: { label: 'Панель управления', icon: 'operations', capabilities: 'Мониторинг доступен владельцу в Operations. Вход нужно отдельно подтвердить в боте. Пользователи и роли находятся во вкладке «Управление».' },
};

const iconPaths = {
  memory: ['M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 6 6', 'M12 3a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6', 'M8 9h8', 'M8 15h8'],
  documents: ['M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
  devices: ['M4 5h16v11H4z', 'M9 20h6', 'M12 16v4'],
  life: ['M3 12h4l3-6 4 12 3-6h4'],
  vpn: ['M12 2 4 6v6c0 5 3.4 8.1 8 10 4.6-1.9 8-5 8-10V6z', 'M9 12l2 2 4-4'],
  operations: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M8 4v4', 'M16 10v4', 'M10 16v4'],
};

function icon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const value of iconPaths[kind] || iconPaths.documents) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', value);
    svg.append(path);
  }
  return svg;
}

function element(tag, className, content = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

function sectionCard(kind, title, detail) {
  const card = element('li', 'section-card');
  const symbol = element('span', 'section-card__icon');
  symbol.append(icon(kind));
  const personal = ['memory', 'documents', 'devices', 'life'].includes(kind);
  const content = element(personal ? 'details' : 'div', 'section-card__content');
  const titleNode = element('strong', 'section-card__title', title);
  if (personal) {
    const summary = element('summary', 'section-card__summary');
    summary.append(titleNode, element('span', 'section-card__toggle', 'Подробнее'));
    content.append(summary);
  } else content.append(titleNode);
  if (detail) content.append(element('p', 'section-card__detail', detail));
  card.append(symbol, content);
  return card;
}

function emptyState(message, hint) {
  const empty = element('div', 'section-empty');
  empty.append(element('strong', '', message), element('p', '', hint));
  return empty;
}

function navigationUrl(permission, action) {
  try {
    const url = new URL(action.href);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    if (action.kind === 'telegram') {
      if (url.origin !== 'https://t.me' || !/^\/[A-Za-z][A-Za-z0-9_]{4,31}$/.test(url.pathname)
        || [...url.searchParams].length !== 1 || url.searchParams.get('start') !== `mini_${permission}`) return null;
    } else if (action.kind === 'operations') {
      if (permission !== 'operations' || url.pathname !== '/ops/' || url.search) return null;
    } else return null;
    return url.href;
  } catch { return null; }
}

export function renderSectionActions(permission, actions = [], { memoryActionsAvailable = false } = {}) {
  const info = sectionInfo[permission];
  const root = element('div', 'section-handoff');
  if (!info) return root;
  root.append(element('p', 'section-handoff__hint', permission === 'memory' && memoryActionsAvailable
    ? 'Добавляй, исправляй и удаляй записи здесь. Перед сохранением приложение покажет изменение и попросит подтверждение.' : info.capabilities));
  const links = element('nav', 'section-handoff__links');
  links.setAttribute('aria-label', `Действия раздела: ${info.label}`);
  const emitted = new Set();
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action || emitted.has(action.kind)) continue;
    const href = navigationUrl(permission, action);
    if (!href) continue;
    emitted.add(action.kind);
    const link = element('a', 'secondary', action.kind === 'operations' ? 'Открыть Operations' : `Открыть «${info.label}» в боте`);
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.dataset.destination = action.kind;
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const sdk = window.Telegram?.WebApp;
      const method = action.kind === 'telegram' ? sdk?.openTelegramLink : sdk?.openLink;
      if (typeof method !== 'function') return;
      try { method.call(sdk, href); event.preventDefault(); } catch { /* The HTTPS anchor remains available. */ }
    });
    links.append(link);
  }
  if (links.children.length) root.append(links);
  else if (!memoryActionsAvailable) root.append(element('p', 'section-handoff__hint', 'Открой личный чат с ботом и выбери нужный раздел в меню.'));
  return root;
}

export function renderSectionView(permission, { items = [], notice = '', actions = [], paging = {}, available = true } = {}, options = {}) {
  const info = sectionInfo[permission] || { label: 'Раздел', icon: 'documents' };
  const root = element('div', 'section-browser');
  root.id = 'section-items';
  root.dataset.section = permission;
  root.append(renderSectionActions(permission, actions, { memoryActionsAvailable: Boolean(options.memoryActions) }));
  if (permission === 'memory' && options.memoryActions) root.append(options.memoryActions.element);
  const rows = Array.isArray(items) ? items : [];

  if (['memory', 'documents', 'devices', 'life'].includes(permission)) {
    const tools = element('div', 'section-list-tools');
    const refresh = element('button', 'secondary', 'Обновить список'); refresh.type = 'button';
    const more = element('button', 'secondary', 'Загрузить ещё'); more.type = 'button';
    more.hidden = !paging.nextCursor;
    const feedback = element('p', 'section-list-feedback'); feedback.setAttribute('role', 'status');
    let refreshing = false; let loadingMore = false; let actionVersion = 0;
    function controls() { refresh.disabled = refreshing; more.disabled = refreshing || loadingMore; }
    async function run(kind) {
      if (refreshing || (kind === 'more' && loadingMore)) return;
      const version = ++actionVersion;
      if (kind === 'refresh') refreshing = true; else loadingMore = true;
      controls(); feedback.textContent = kind === 'refresh' ? 'Обновляем список…' : 'Загружаем следующие записи…';
      try {
        if (kind === 'refresh') await options.onRefresh?.();
        else await options.onLoadMore?.(paging.nextCursor);
        if (version === actionVersion) feedback.textContent = '';
      } catch {
        if (version === actionVersion) feedback.textContent = 'Не удалось загрузить записи. Показанный список сохранён. Повтори запрос или обнови список.';
      } finally { if (kind === 'refresh') refreshing = false; else loadingMore = false; controls(); }
    }
    refresh.disabled = typeof options.onRefresh !== 'function';
    more.disabled = typeof options.onLoadMore !== 'function';
    refresh.addEventListener('click', () => { void run('refresh'); });
    more.addEventListener('click', () => { void run('more'); });
    tools.append(refresh, more, feedback); root.append(tools);
  }

  if ((permission === 'vpn' || permission === 'operations') && rows.length === 0) {
    const list = element('ul', 'section-cards');
    list.append(sectionCard(info.icon, info.label, String(notice || 'Информация об этом разделе пока недоступна.')));
    root.append(list);
    return root;
  }

  if (rows.length === 0) {
    root.append(emptyState(available ? info.empty || 'В этом разделе пока нет данных.' : 'Раздел временно недоступен.',
      available ? info.hint || 'Данные появятся здесь, когда раздел будет доступен.' : notice || 'Обнови список позже.'));
    return root;
  }

  const cards = element('ul', 'section-cards');
  const searchRows = [];
  for (const item of rows) {
    const title = typeof item === 'string' ? item : item?.title;
    const detail = typeof item === 'string' ? '' : item?.detail;
    const safeTitle = String(title || 'Без названия');
    const deviceStates = { online: 'В сети', connected: 'Подключено', healthy: 'Работает', offline: 'Не в сети', disconnected: 'Нет связи', paired: 'Связано с Jarvis', error: 'Ошибка подключения', unknown: 'Состояние неизвестно' };
    const safeDetail = permission === 'devices' && Object.hasOwn(deviceStates, detail) ? deviceStates[detail] : detail == null ? '' : String(detail);
    const card = sectionCard(info.icon, safeTitle, safeDetail);
    if (permission === 'memory' && options.memoryActions) {
      const controls = element('div', 'memory-actions__controls');
      controls.append(options.memoryActions.actionButton('correct', item), options.memoryActions.actionButton('forget', item));
      card.querySelector('.section-card__content').append(controls);
    }
    cards.append(card);
    searchRows.push({ card, text: `${safeTitle} ${safeDetail}`.toLocaleLowerCase('ru') });
  }

  if (['memory', 'documents', 'devices', 'life'].includes(permission)) {
    const filter = element('div', 'section-filter');
    const label = element('label', '', `Поиск в разделе: ${info.label}`);
    const input = document.createElement('input');
    input.type = 'search';
    input.id = `section-filter-${permission}`;
    label.htmlFor = input.id;
    input.setAttribute('aria-label', label.textContent);
    input.placeholder = 'Найти в загруженных записях';
    input.value = options.filterQuery || '';
    const status = element('p', 'section-filter__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const noResults = emptyState('Ничего не найдено.', 'Попробуй другой запрос.');
    noResults.hidden = true;
    function updateFilter() {
      const query = input.value.trim().toLocaleLowerCase('ru');
      options.onFilterChange?.(input.value);
      let visible = 0;
      for (const row of searchRows) {
        row.card.hidden = Boolean(query) && !row.text.includes(query);
        if (!row.card.hidden) visible++;
      }
      status.textContent = `Показано ${visible} из ${searchRows.length}. Поиск в загруженных записях.${paging.nextCursor ? ' Доступны следующие записи.' : ''}`;
      noResults.hidden = visible !== 0;
    }
    input.addEventListener('input', updateFilter);
    filter.append(label, input, status);
    root.append(filter, cards, noResults);
    updateFilter();
  } else {
    root.append(cards);
  }
  if (permission !== 'memory' || !options.memoryActions) root.append(element('p', 'section-readonly', 'Здесь данные доступны для просмотра. Действия с подтверждением выполняются через Telegram или Desktop.'));
  return root;
}
