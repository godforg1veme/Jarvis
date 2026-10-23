const sectionInfo = {
  memory: {
    label: 'Память',
    empty: 'В памяти пока нет записей.',
    hint: 'Здесь появятся твои сохранённые записи.',
    icon: 'memory',
  },
  documents: {
    label: 'Документы',
    empty: 'Документов пока нет.',
    hint: 'Здесь появятся твои документы.',
    icon: 'documents',
  },
  devices: {
    label: 'Устройства',
    empty: 'Устройств пока нет.',
    hint: 'Здесь появятся твои подключённые устройства.',
    icon: 'devices',
  },
  life: {
    label: 'Life OS',
    empty: 'В Life OS пока нет записей.',
    hint: 'Здесь появятся твои миссии и договорённости.',
    icon: 'life',
  },
  vpn: { label: 'VPN', icon: 'vpn' },
  operations: { label: 'Панель управления', icon: 'operations' },
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
  const content = element('div', 'section-card__content');
  content.append(element('strong', 'section-card__title', title));
  if (detail) content.append(element('p', 'section-card__detail', detail));
  card.append(symbol, content);
  return card;
}

function emptyState(message, hint) {
  const empty = element('div', 'section-empty');
  empty.append(element('strong', '', message), element('p', '', hint));
  return empty;
}

export function renderSectionView(permission, { items = [], notice = '' } = {}) {
  const info = sectionInfo[permission] || { label: 'Раздел', icon: 'documents' };
  const root = element('div', 'section-browser');
  root.id = 'section-items';
  root.dataset.section = permission;
  const rows = Array.isArray(items) ? items : [];

  if ((permission === 'vpn' || permission === 'operations') && rows.length === 0) {
    const list = element('ul', 'section-cards');
    list.append(sectionCard(info.icon, info.label, String(notice || 'Информация об этом разделе пока недоступна.')));
    root.append(list);
    return root;
  }

  if (rows.length === 0) {
    root.append(emptyState(info.empty || 'В этом разделе пока нет данных.', info.hint || 'Данные появятся здесь, когда раздел будет доступен.'));
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
    input.placeholder = 'Найти в загруженном списке';
    const status = element('p', 'section-filter__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const noResults = emptyState('Ничего не найдено.', 'Попробуй другой запрос.');
    noResults.hidden = true;
    function updateFilter() {
      const query = input.value.trim().toLocaleLowerCase('ru');
      let visible = 0;
      for (const row of searchRows) {
        row.card.hidden = Boolean(query) && !row.text.includes(query);
        if (!row.card.hidden) visible++;
      }
      status.textContent = `Показано ${visible} из ${searchRows.length}`;
      noResults.hidden = visible !== 0;
    }
    input.addEventListener('input', updateFilter);
    filter.append(label, input, status);
    root.append(filter, cards, noResults);
    updateFilter();
  } else {
    root.append(cards);
  }
  root.append(element('p', 'section-readonly', 'Здесь данные доступны для просмотра. Действия с подтверждением выполняются через Telegram или Desktop.'));
  return root;
}
