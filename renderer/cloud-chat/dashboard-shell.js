(() => {
  'use strict';
  const pages = new Set(['home', 'assistant', 'life', 'memory', 'documents', 'jobs', 'devices', 'operations', 'settings']);
  const titles = { home: 'Главная', assistant: 'Ассистент', life: 'Life OS', memory: 'Память',
    documents: 'Документы', jobs: 'Поиск работы', devices: 'Устройства', operations: 'Панель управления', settings: 'Настройки' };
  const buttons = [...document.querySelectorAll('[data-desktop-page]')];
  const heading = document.getElementById('desktop-section-heading');
  const home = document.getElementById('desktop-home');
  const chat = document.getElementById('desktop-chat-panel');
  const workspace = document.getElementById('desktop-workspace');
  const workspaceTitle = document.getElementById('desktop-page-title');
  const lifeOpen = document.getElementById('life-os-open');
  let current = 'assistant';

  function show(page, focus = false) {
    if (!pages.has(page)) return;
    current = page;
    for (const button of buttons) {
      if (button.dataset.desktopPage === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    heading.textContent = titles[page];
    home.hidden = page !== 'home';
    chat.hidden = page !== 'assistant';
    workspace.hidden = ['home', 'assistant', 'life'].includes(page);
    workspaceTitle.textContent = titles[page];
    document.body.dataset.desktopView = page;
    if (focus) {
      if (page === 'assistant') document.getElementById('message-input')?.focus();
      else if (!workspace.hidden) workspace.focus();
    }
  }

  for (const button of buttons) button.addEventListener('click', () => {
    const page = button.dataset.desktopPage;
    if (!pages.has(page)) return;
    if (page === 'life') {
      lifeOpen.click();
      window.dispatchEvent(new CustomEvent('desktop:navigate', { detail: { page } }));
      return;
    }
    show(page, true);
    window.dispatchEvent(new CustomEvent('desktop:navigate', { detail: { page } }));
  });
  window.addEventListener('desktop:page', (event) => {
    const page = event.detail?.page;
    if (page === 'life') { lifeOpen.click(); return; }
    show(page, false);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !workspace.hidden && !document.querySelector('dialog[open]')) {
      show('assistant', true);
      window.dispatchEvent(new CustomEvent('desktop:navigate', { detail: { page: 'assistant' } }));
    }
  });
  show(current);
})();
