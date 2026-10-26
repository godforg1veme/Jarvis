const { operationsPanelUrl: operationsHref } = require('../operations/operationsUrl');

const TELEGRAM_SECTIONS = Object.freeze({
  memory: 'Память', documents: 'Документы', devices: 'Устройства',
  life: 'Life OS', jobs: 'Поиск работы', vpn: 'VPN', operations: 'Operations',
});

function sectionNavigation(permission, actor, { getTelegramBotUsername, operationsEnabled, operationsPublicOrigin } = {}) {
  const actions = [];
  const owner = actor?.level === 'owner';
  if (Object.hasOwn(TELEGRAM_SECTIONS, permission) && (owner || !['vpn', 'operations'].includes(permission))) {
    let username = null;
    try { username = getTelegramBotUsername?.(); } catch { /* Bot initialization can still be pending. */ }
    if (typeof username === 'string' && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
      actions.push({ kind: 'telegram', href: `https://t.me/${username}?start=mini_${permission}`,
        label: `Открыть ${TELEGRAM_SECTIONS[permission]} в боте` });
    }
  }
  if (permission === 'operations' && owner) {
    const href = operationsHref(operationsEnabled, operationsPublicOrigin);
    if (href) actions.push({ kind: 'operations', href, label: 'Открыть Operations' });
  }
  return actions;
}

module.exports = { sectionNavigation, operationsHref };
