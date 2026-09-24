const MENU = Object.freeze({
  HOME: '🏠 Главное',
  LIFE: '🎯 Life OS',
  MEMORY: '🧠 Память',
  DOCUMENTS: '📄 Документы',
  DEVICES: '🖥 Устройства',
  VPN: '🔐 VPN',
  OPERATIONS: '📊 Панель',
  HELP: '❓ Помощь',
});

const ACTION_BY_LABEL = new Map([
  [MENU.HOME, 'home'], [MENU.LIFE, 'life'], [MENU.MEMORY, 'memory'],
  [MENU.DOCUMENTS, 'documents'], [MENU.DEVICES, 'devices'], [MENU.VPN, 'vpn'],
  [MENU.OPERATIONS, 'operations'], [MENU.HELP, 'help'],
]);

function menuAction(value) {
  return ACTION_BY_LABEL.get(String(value || '')) || null;
}

function replyKeyboard(owner) {
  const keyboard = [
    [{ text: MENU.HOME }, { text: MENU.LIFE }],
    [{ text: MENU.MEMORY }, { text: MENU.DOCUMENTS }],
    [{ text: MENU.DEVICES }, ...(owner ? [{ text: MENU.VPN }] : [{ text: MENU.HELP }])],
  ];
  if (owner) keyboard.push([{ text: MENU.OPERATIONS }, { text: MENU.HELP }]);
  return { keyboard, resize_keyboard: true, is_persistent: true };
}

function isOwner(user, telegramUserId, ownerTelegramId) {
  return user?.role === 'owner' || (String(ownerTelegramId || '') !== '0' && String(telegramUserId || '') === String(ownerTelegramId));
}

module.exports = { MENU, isOwner, menuAction, replyKeyboard };
